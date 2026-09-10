'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseEventLogs, type Hex } from 'viem'
import { Coin, type CoinState } from '../components/Coin'
import { coinFlipAbi } from '../contracts/abis'
import { COINFLIP_ADDRESS, IS_DEPLOYED, LEAD_ROUNDS } from '../config/deployments'
import { robinhoodTestnet } from '../config/chain'
import { useAllFlips, useFlip, useFlipStatus, type FlipRow } from '../hooks/useFlips'
import { useNow } from '../hooks/useNow'
import { drandRoundUrl, fetchBeacon, roundScheduledTime, SIDE_LABEL, type Side } from '../lib/drand'
import { verifyFlip, type Verification } from '../lib/verify'
import { explorerTx, shortHash, ts } from '../lib/format'
import { useOpenHow } from '../components/Shell'

type Phase = 'idle' | 'committing' | 'waiting' | 'revealing' | 'settled'
type Flow = { phase: Phase; id?: bigint; targetRound?: bigint; commitTx?: Hex; settleTx?: Hex; error?: string }

export default function FlipPage() {
  const openHow = useOpenHow()
  const { address, isConnected, chainId } = useAccount()
  const client = usePublicClient({ chainId: robinhoodTestnet.id })
  const { writeContractAsync } = useWriteContract()
  const now = useNow()

  const [choice, setChoice] = useState<Side>(0)
  const [flow, setFlow] = useState<Flow>({ phase: 'idle' })
  const [sig, setSig] = useState<string | null>(null)
  const [verification, setVerification] = useState<Verification | null>(null)
  const [nudge, setNudge] = useState<'idle' | 'settling' | 'off'>('idle')

  const status = useFlipStatus(flow.phase === 'waiting' || flow.phase === 'revealing' ? flow.id : undefined)
  const flipRead = useFlip(flow.id, flow.phase === 'settled' ? false : 2500)
  const flip = flipRead.data as FlipRow | undefined
  const { flips } = useAllFlips(5000)
  const myPending = useMemo(() => flips.filter((f) => address && f.player.toLowerCase() === address.toLowerCase() && !f.settled && f.id !== flow.id), [flips, address, flow.id])

  const onChain = isConnected && chainId === robinhoodTestnet.id
  const scheduled = flow.targetRound ? roundScheduledTime(flow.targetRound) : 0
  const secondsLeft = Math.max(0, scheduled + 1 - now)
  const due = flow.targetRound !== undefined && secondsLeft === 0
  const commitTime = flip ? Number(flip.commitTime) : scheduled - LEAD_ROUNDS * 3
  const progress = scheduled ? Math.min(1, Math.max(0, (now - commitTime) / (scheduled + 1 - commitTime))) : 0

  useEffect(() => {
    if ((flow.phase === 'waiting' || flow.phase === 'revealing') && status.data?.[0]) setFlow((f) => ({ ...f, phase: 'settled' }))
  }, [status.data, flow.phase])

  useEffect(() => {
    if (flow.phase !== 'waiting' || !due || sig || !flow.targetRound) return
    const ctrl = new AbortController()
    let cancelled = false
    const tryFetch = async () => {
      for (let i = 0; i < 20 && !cancelled; i++) {
        try {
          const b = await fetchBeacon(flow.targetRound!, ctrl.signal)
          if (!cancelled) setSig('0x' + b.signature)
          return
        } catch {
          await new Promise((r) => setTimeout(r, 1000))
        }
      }
    }
    void tryFetch()
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [flow.phase, due, sig, flow.targetRound])

  // Nudge the server-side relayer as soon as the round is public. The user can still Reveal
  // themselves; whichever settles first wins and the other sees AlreadySettled.
  useEffect(() => {
    if (flow.phase !== 'waiting' || !due || nudge !== 'idle' || flow.id === undefined) return
    setNudge('settling') // optimistic; the route waits for the receipt before answering
    const id = flow.id
    const run = async () => {
      for (let i = 0; i < 6; i++) {
        try {
          const res = await fetch('/api/settle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id.toString() }) })
          if (res.status === 503) return setNudge('off')
          if (res.ok) return
          if (res.status === 425) {
            await new Promise((r) => setTimeout(r, 1500))
            continue
          }
          return setNudge('off')
        } catch {
          return setNudge('off')
        }
      }
      setNudge('off')
    }
    void run()
  }, [flow.phase, due, nudge, flow.id])

  useEffect(() => {
    if (flow.phase !== 'settled' || !flip?.settled || verification) return
    verifyFlip(robinhoodTestnet.id, COINFLIP_ADDRESS, { ...flip, id: flow.id! }).then(setVerification).catch(() => {})
  }, [flow.phase, flip, verification, flow.id])

  const reset = () => {
    setFlow({ phase: 'idle' })
    setSig(null)
    setVerification(null)
    setNudge('idle')
  }

  const commit = async () => {
    if (!client) return
    setFlow({ phase: 'committing' })
    try {
      const hash = await writeContractAsync({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'flip', args: [choice], chainId: robinhoodTestnet.id })
      setFlow({ phase: 'committing', commitTx: hash })
      const receipt = await client.waitForTransactionReceipt({ hash })
      const [ev] = parseEventLogs({ abi: coinFlipAbi, logs: receipt.logs, eventName: 'FlipCommitted' })
      if (!ev) throw new Error('FlipCommitted event not found')
      setFlow({ phase: 'waiting', id: ev.args.id, targetRound: BigInt(ev.args.targetRound), commitTx: hash })
    } catch (e) {
      setFlow({ phase: 'idle', error: cleanError(e) })
    }
  }

  const reveal = useCallback(
    async (id: bigint, round: bigint, signature: string | null) => {
      if (!client) return
      setFlow((f) => ({ ...f, phase: 'revealing', id, targetRound: round, error: undefined }))
      try {
        const st = await client.readContract({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'flipStatus', args: [id] })
        let hash: Hex
        if (st[1]) {
          hash = await writeContractAsync({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'settle', args: [id], chainId: robinhoodTestnet.id })
        } else {
          const s = signature ?? '0x' + (await fetchBeacon(round)).signature
          hash = await writeContractAsync({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'settleWithBeacon', args: [id, s as Hex], chainId: robinhoodTestnet.id })
        }
        setFlow((f) => ({ ...f, settleTx: hash }))
        await client.waitForTransactionReceipt({ hash })
        await flipRead.refetch()
        setFlow((f) => ({ ...f, phase: 'settled', settleTx: hash }))
      } catch (e) {
        const msg = cleanError(e)
        if (/AlreadySettled/i.test(msg)) {
          await flipRead.refetch()
          setFlow((f) => ({ ...f, phase: 'settled' }))
        } else {
          setFlow((f) => ({ ...f, phase: 'waiting', error: msg }))
        }
      }
    },
    [client, writeContractAsync, flipRead],
  )

  const resumePending = (f: FlipRow) => {
    setVerification(null)
    setSig(null)
    setNudge('idle')
    setFlow({ phase: 'waiting', id: f.id, targetRound: f.targetRound })
  }

  const settledResult = flow.phase === 'settled' && flip?.settled ? flip.result : undefined
  const coinState: CoinState =
    settledResult !== undefined ? (settledResult === 0 ? 'heads' : 'tails') : flow.phase === 'revealing' ? 'tossing-fast' : flow.phase === 'waiting' ? 'tossing' : flow.phase === 'committing' ? 'arming' : 'idle'
  const won = settledResult !== undefined && flip ? flip.result === flip.choice : undefined
  const glowCls = won === undefined ? (flow.phase === 'waiting' || flow.phase === 'revealing' ? 'tossing' : '') : won ? 'win' : 'lose'

  return (
    <div className="flip-page">
      <div className={'stage' + (won === true ? ' win' : '') + (settledResult !== undefined ? ' settled' : '')}>
        <div className={'stage-glow ' + glowCls} />
        <div className="stage-flash" />
        <Coin state={coinState} />

        <div className="status">
          {flow.phase === 'idle' && (
            <>
              <div className="status-title">Call it</div>
              <div className="status-sub">Pick a side and flip. Gas only, nothing at stake.</div>
            </>
          )}
          {flow.phase === 'committing' && (
            <>
              <div className="status-title">Locking in your call…</div>
              <div className="status-sub">{flow.commitTx ? 'Waiting for confirmation.' : 'Confirm in your wallet.'}</div>
            </>
          )}
          {flow.phase === 'waiting' && (
            <>
              <div className="status-title">{due ? (nudge === 'settling' ? 'Beacon is live. Settling…' : sig ? 'Beacon is live. Reveal!' : 'Fetching beacon…') : 'Coin is in the air'}</div>
              <div className="status-sub">{due ? (nudge === 'settling' ? 'Our relayer is verifying the signature on-chain. You can also reveal it yourself.' : 'drand published the round. Reveal verifies it on-chain and settles.') : `Bound to drand round ${flow.targetRound}, which does not exist yet.`}</div>
            </>
          )}
          {flow.phase === 'revealing' && (
            <>
              <div className="status-title">Verifying on-chain…</div>
              <div className="status-sub">{flow.settleTx ? 'BLS pairing check running. Waiting for confirmation.' : 'Confirm the reveal in your wallet.'}</div>
            </>
          )}
          {settledResult !== undefined && flip && (
            <>
              <div className={'result-title ' + (won ? 'win' : 'lose')}>{SIDE_LABEL[flip.result]}</div>
              <div className="status-sub result-sub">
                {won ? 'You called it.' : `You called ${SIDE_LABEL[flip.choice]}.`} {verification ? (verification.ok ? 'Verified locally ✓' : 'LOCAL VERIFICATION MISMATCH') : ''}
              </div>
            </>
          )}
          {flow.phase === 'settled' && settledResult === undefined && <div className="status-title">Loading result…</div>}
        </div>

        {(flow.phase === 'waiting' || flow.phase === 'revealing') && flow.targetRound && (
          <div className="countdown">
            <div className="countdown-bar">
              <div className="countdown-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="countdown-meta">
              <span>round {flow.targetRound.toString()}</span>
              <span>{due ? 'published' : `${secondsLeft.toFixed(1)}s`}</span>
            </div>
          </div>
        )}

        {flow.phase === 'idle' && (
          <>
            <div className="segment" role="radiogroup" aria-label="Call">
              <div className={'segment-thumb' + (choice === 1 ? ' right' : '')} />
              <button role="radio" aria-checked={choice === 0} className={choice === 0 ? 'on' : ''} onClick={() => setChoice(0)}>
                <span className="mini-coin">H</span> Heads
              </button>
              <button role="radio" aria-checked={choice === 1} className={choice === 1 ? 'on' : ''} onClick={() => setChoice(1)}>
                <span className="mini-coin">T</span> Tails
              </button>
            </div>
            <div className="actions">
              <button className="btn btn-gold btn-lg" onClick={commit} disabled={!onChain || !IS_DEPLOYED}>
                {!isConnected ? 'Connect a wallet to flip' : !onChain ? 'Switch to Robinhood Testnet' : `Flip for ${SIDE_LABEL[choice]}`}
              </button>
            </div>
          </>
        )}

        {flow.phase === 'waiting' && (
          <div className="actions">
            <button className="btn btn-gold btn-lg" onClick={() => reveal(flow.id!, flow.targetRound!, sig)} disabled={!due || !onChain}>
              {due ? 'Reveal result' : `Reveal in ${Math.ceil(secondsLeft)}s`}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={reset}>
              Leave pending
            </button>
          </div>
        )}

        {flow.phase === 'settled' && (
          <div className="actions">
            <button className="btn btn-gold btn-lg" onClick={reset}>
              Flip again
            </button>
          </div>
        )}

        {flow.error && <div className="error">{flow.error}</div>}

        <button className="how-link" onClick={openHow}>
          <span className="icon-btn" style={{ width: 20, height: 20, fontSize: 11 }}>?</span> How is this random?
        </button>
      </div>

      <div className="below">
        {flow.id !== undefined && flip && (
          <details className="card" open={settledResult !== undefined}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Proof for flip #{flow.id.toString()}</summary>
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>drand round</dt>
              <dd>
                <a href={drandRoundUrl(flip.targetRound)} target="_blank" rel="noreferrer">{flip.targetRound.toString()} ↗</a>
              </dd>
              <dt>scheduled at</dt>
              <dd>{ts(roundScheduledTime(flip.targetRound))}</dd>
              <dt>committed at</dt>
              <dd>{ts(flip.commitTime)}</dd>
              {flow.commitTx && (
                <>
                  <dt>commit tx</dt>
                  <dd><a href={explorerTx(flow.commitTx)} target="_blank" rel="noreferrer">{shortHash(flow.commitTx)} ↗</a></dd>
                </>
              )}
              {flip.settled && (
                <>
                  <dt>randomness</dt>
                  <dd title="sha256(BLS signature) as stored by the registry">{flip.randomness}</dd>
                  <dt>seed</dt>
                  <dd>{flip.seed}</dd>
                  <dt>result</dt>
                  <dd>{SIDE_LABEL[flip.result]} · seed is {flip.result === 0 ? 'even' : 'odd'}</dd>
                  {flow.settleTx && (
                    <>
                      <dt>settle tx</dt>
                      <dd><a href={explorerTx(flow.settleTx)} target="_blank" rel="noreferrer">{shortHash(flow.settleTx)} ↗</a></dd>
                    </>
                  )}
                  <dt>local check</dt>
                  <dd>
                    {verification ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span className="checks">
                          <span className={'check ' + (verification.randomnessOk ? 'ok' : 'fail')} title="sha256(signature) matches">1</span>
                          <span className={'check ' + (verification.seedOk ? 'ok' : 'fail')} title="seed matches">2</span>
                          <span className={'check ' + (verification.resultOk ? 'ok' : 'fail')} title="result matches">3</span>
                        </span>
                        <span style={{ fontFamily: 'var(--sans)', color: verification.ok ? 'var(--good)' : 'var(--bad)' }}>{verification.ok ? 'recomputed in your browser from api.drand.sh' : 'MISMATCH'}</span>
                      </span>
                    ) : (
                      <span className="spinner" />
                    )}
                  </dd>
                </>
              )}
            </dl>
          </details>
        )}

        {myPending.length > 0 && (
          <div className="card">
            <p className="card-title">Your pending flips</p>
            <div className="pending-list">
              {myPending.map((f) => {
                const left = Math.max(0, roundScheduledTime(f.targetRound) + 1 - now)
                return (
                  <div className="pending" key={f.id.toString()}>
                    <span className="mono">#{f.id.toString()}</span>
                    <span className={'pill ' + (f.choice === 0 ? 'heads' : 'tails')}>{SIDE_LABEL[f.choice]}</span>
                    <span className="mono grow">round {f.targetRound.toString()}</span>
                    <button className="btn btn-sm" onClick={() => resumePending(f)} disabled={flow.phase === 'committing' || flow.phase === 'revealing'}>
                      {left > 0 ? `${Math.ceil(left)}s` : 'Reveal'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function cleanError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string }
  const m = err?.shortMessage ?? err?.message ?? String(e)
  return m.split('\n')[0].slice(0, 240)
}
