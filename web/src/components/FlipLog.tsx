'use client'
import { useState } from 'react'
import { useChainId } from 'wagmi'
import type { FlipRow } from '../hooks/useFlips'
import { verifyFlip, type Verification } from '../lib/verify'
import { COINFLIP_ADDRESS } from '../config/deployments'
import { drandRoundUrl, SIDE_LABEL } from '../lib/drand'
import { explorerAddr, short, shortHash, ts } from '../lib/format'
import { robinhoodTestnet } from '../config/chain'

type VState = { status: 'idle' } | { status: 'running' } | { status: 'done'; v: Verification } | { status: 'error'; message: string }

export function FlipLog({ flips }: { flips: FlipRow[] }) {
  const chainId = useChainId() || robinhoodTestnet.id
  const [state, setState] = useState<Record<string, VState>>({})
  const [busyAll, setBusyAll] = useState(false)

  const run = async (f: FlipRow) => {
    const k = f.id.toString()
    setState((s) => ({ ...s, [k]: { status: 'running' } }))
    try {
      const v = await verifyFlip(robinhoodTestnet.id ?? chainId, COINFLIP_ADDRESS, f)
      setState((s) => ({ ...s, [k]: { status: 'done', v } }))
    } catch (e) {
      setState((s) => ({ ...s, [k]: { status: 'error', message: (e as Error).message } }))
    }
  }

  const verifyAll = async () => {
    setBusyAll(true)
    const todo = flips.filter((f) => f.settled && state[f.id.toString()]?.status !== 'done')
    for (let i = 0; i < todo.length; i += 4) await Promise.all(todo.slice(i, i + 4).map(run))
    setBusyAll(false)
  }

  const verified = Object.values(state).filter((s) => s.status === 'done' && s.v.ok).length
  const rows = [...flips].sort((a, b) => Number(b.id - a.id))

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <h2 style={{ margin: 0 }}>Flip log</h2>
          <div className="chart-sub">Newest first. Verify re-derives the result from drand's public API.</div>
        </div>
        <div className="grow" />
        {verified > 0 && <span className="pill good">✓ {verified} verified locally</span>}
        <button className="btn btn-sm" onClick={verifyAll} disabled={busyAll || !flips.some((f) => f.settled)}>
          {busyAll ? <span className="spinner" /> : null} Verify all settled
        </button>
      </div>
      <div className="table-wrap">
        {rows.length === 0 ? (
          <div className="empty">No flips yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th>Called</th>
                <th>Result</th>
                <th>drand round</th>
                <th className="col-opt">Randomness</th>
                <th className="col-opt">Committed</th>
                <th>Verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const k = f.id.toString()
                const s = state[k] ?? { status: 'idle' }
                const won = f.settled && f.result === f.choice
                return (
                  <tr key={k}>
                    <td className="mono">{k}</td>
                    <td className="mono">
                      <a href={explorerAddr(f.player)} target="_blank" rel="noreferrer">{short(f.player)}</a>
                    </td>
                    <td><span className={'pill ' + (f.choice === 0 ? 'heads' : 'tails')}>{SIDE_LABEL[f.choice]}</span></td>
                    <td>
                      {f.settled ? (
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <span className={'pill ' + (f.result === 0 ? 'heads' : 'tails')}>{SIDE_LABEL[f.result]}</span>
                          <span className={'pill ' + (won ? 'good' : 'bad')}>{won ? 'win' : 'loss'}</span>
                        </span>
                      ) : (
                        <span className="pill pending">pending</span>
                      )}
                    </td>
                    <td className="mono">
                      <a href={drandRoundUrl(f.targetRound)} target="_blank" rel="noreferrer" title="Open on api.drand.sh">{f.targetRound.toString()}</a>
                    </td>
                    <td className="mono col-opt" title={f.randomness}>{f.settled ? shortHash(f.randomness) : '—'}</td>
                    <td className="mono col-opt">{ts(f.commitTime)}</td>
                    <td>
                      {!f.settled ? (
                        <span style={{ color: 'var(--text-3)', fontSize: 12 }}>awaiting beacon</span>
                      ) : (
                        <div className="verify-cell">
                          {s.status === 'done' ? (
                            <>
                              <span className="checks" title="sha256(signature) = randomness · seed matches · result matches">
                                <span className={'check ' + (s.v.randomnessOk ? 'ok' : 'fail')} title="drand signature hash matches on-chain randomness">1</span>
                                <span className={'check ' + (s.v.seedOk ? 'ok' : 'fail')} title="seed recomputed locally matches">2</span>
                                <span className={'check ' + (s.v.resultOk ? 'ok' : 'fail')} title="result derived from seed matches">3</span>
                              </span>
                              <span className={'pill ' + (s.v.ok ? 'good' : 'bad')}>{s.v.ok ? 'verified' : 'MISMATCH'}</span>
                            </>
                          ) : s.status === 'error' ? (
                            <span className="pill bad" title={s.message}>error</span>
                          ) : (
                            <button className="btn btn-sm" onClick={() => run(f)} disabled={s.status === 'running'}>
                              {s.status === 'running' ? <span className="spinner" /> : null} Verify
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
