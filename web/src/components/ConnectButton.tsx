'use client'
import { useEffect, useRef, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { robinhoodTestnet } from '../config/chain'
import { short } from '../lib/format'

export function ConnectButton() {
  const { address, isConnected, chainId } = useAccount()
  const { connectors, connect, isPending, error } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, isPending: switching } = useSwitchChain()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Wallet state comes from the browser (extension / storage) and cannot match the server render.
  // Render a neutral button until mounted so hydration is deterministic.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const wrongChain = isConnected && chainId !== robinhoodTestnet.id

  if (!mounted) {
    return (
      <div className="connect">
        <button className="btn btn-primary" disabled aria-hidden="true" style={{ visibility: 'hidden' }}>
          Connect wallet
        </button>
      </div>
    )
  }

  if (!isConnected) {
    const list = connectors.filter((c, i, arr) => arr.findIndex((x) => x.name === c.name) === i)
    return (
      <div className="connect menu" ref={ref}>
        <button className="btn btn-primary" onClick={() => setOpen((o) => !o)} disabled={isPending}>
          {isPending ? <span className="spinner" /> : null}
          Connect wallet
        </button>
        {open && (
          <div className="menu-pop">
            {list.length === 0 && <div style={{ padding: 10, fontSize: 13, color: 'var(--text-3)' }}>No browser wallet found. Install MetaMask or Rabby.</div>}
            {list.map((c) => (
              <button
                key={c.uid}
                onClick={() => {
                  connect({ connector: c, chainId: robinhoodTestnet.id })
                  setOpen(false)
                }}
              >
                {c.icon ? <img src={c.icon} alt="" /> : <span style={{ width: 20 }} />}
                {c.name}
              </button>
            ))}
            {error && <div className="error" style={{ margin: 6 }}>{error.message.split('\n')[0]}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="connect menu" ref={ref}>
      {wrongChain ? (
        <button className="chain-pill wrong" onClick={() => switchChain({ chainId: robinhoodTestnet.id })} disabled={switching}>
          <span className="dot" /> {switching ? 'Switching…' : 'Switch network'}
        </button>
      ) : (
        <span className="chain-pill" title="Robinhood Chain Testnet">
          <span className="dot" /> <span className="pill-txt">Robinhood Testnet</span>
        </span>
      )}
      <button className="btn" onClick={() => setOpen((o) => !o)}>
        <span className="addr">{short(address!)}</span>
      </button>
      {open && (
        <div className="menu-pop">
          <button onClick={() => navigator.clipboard?.writeText(address!)}>Copy address</button>
          <button onClick={() => window.open(`https://explorer.testnet.chain.robinhood.com/address/${address}`, '_blank')}>View on explorer</button>
          <button onClick={() => { disconnect(); setOpen(false) }}>Disconnect</button>
        </div>
      )}
    </div>
  )
}
