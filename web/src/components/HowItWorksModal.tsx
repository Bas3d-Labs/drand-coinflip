'use client'
import { useEffect } from 'react'
import { LEAD_ROUNDS } from '../config/deployments'
import { REPO_URL } from '../config/links'

export function HowItWorksModal({ open, onClose, stepIdx = 0 }: { open: boolean; onClose: () => void; stepIdx?: number }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="How the randomness works">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>How the randomness works</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p>
          Each flip commits to a <em>future</em> drand Quicknet round chosen by the contract. When the League of Entropy publishes that round, its BLS signature is
          verified on-chain and turned into your result. Nobody, including the contract, can know it in advance.
        </p>
        <div className="steps">
          <Step n={1} idx={stepIdx} title="Commit" desc={<>You call a side. The contract picks drand round <code>latestScheduledRound() + {LEAD_ROUNDS}</code>. You cannot choose or influence it.</>} />
          <Step n={2} idx={stepIdx} title="Wait for the beacon" desc={<>Quicknet publishes one BLS12-381 threshold signature every 3s. The target round does not exist yet at commit time.</>} />
          <Step n={3} idx={stepIdx} title="Import & verify on-chain" desc={<>Anyone submits the 48-byte signature to the registry. It is checked with a BLS pairing (EIP-2537) against Quicknet's public key and cached as <code>sha256(signature)</code>.</>} />
          <Step n={4} idx={stepIdx} title="Settle" desc={<>The contract reads exactly that round, derives <code>seed = keccak(seedDomain, tag, chainId, contract, id, round, randomness)</code> and picks Heads/Tails by rejection sampling.</>} />
        </div>
        <div className="modal-links">
          <a className="btn btn-sm" href={REPO_URL} target="_blank" rel="noreferrer">
            Registry source ↗
          </a>
          <a className="btn btn-sm" href="https://api.drand.sh/v2/beacons/quicknet/info" target="_blank" rel="noreferrer">
            drand Quicknet ↗
          </a>
          <a className="btn btn-sm" href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer">
            Testnet faucet ↗
          </a>
        </div>
      </div>
    </div>
  )
}

function Step({ n, idx, title, desc }: { n: number; idx: number; title: string; desc: React.ReactNode }) {
  const cls = 'step' + (idx > n ? ' done' : idx === n ? ' active' : '')
  return (
    <div className={cls}>
      <div className="step-dot">{idx > n ? '✓' : n}</div>
      <div>
        <div className="step-title">{title}</div>
        <div className="step-desc">{desc}</div>
      </div>
    </div>
  )
}
