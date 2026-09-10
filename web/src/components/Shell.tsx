'use client'
import { createContext, useContext, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'
import { HowItWorksModal } from './HowItWorksModal'
import { IS_DEPLOYED } from '@/config/deployments'

const HowCtx = createContext<() => void>(() => {})
export const useOpenHow = () => useContext(HowCtx)

export function Shell({ children }: { children: React.ReactNode }) {
  const [how, setHow] = useState(false)
  const path = usePathname()
  return (
    <HowCtx.Provider value={() => setHow(true)}>
      <div className="app">
        <div className="bg" aria-hidden="true" />
        <header className="topbar">
          <div className="brand">
            <span className="brand-coin" aria-hidden="true" />
            <span className="brand-title">drand Coin Flip</span>
          </div>
          <nav className="nav">
            <Link href="/" className={path === '/' ? 'active' : ''}>
              Flip
            </Link>
            <Link href="/dashboard" className={path.startsWith('/dashboard') ? 'active' : ''}>
              Dashboard
            </Link>
          </nav>
          <div className="topbar-right">
            <button className="icon-btn" onClick={() => setHow(true)} aria-label="How it works" title="How it works">
              ?
            </button>
            <ConnectButton />
          </div>
        </header>

        {!IS_DEPLOYED && (
          <div className="banner warn">
            Contract not deployed yet. Run <code>forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast</code> then <code>pnpm sync-deployment</code>.
          </div>
        )}

        <main className="main">{children}</main>

        <footer className="footer">
          <span>Robinhood Chain Testnet · drand Quicknet</span>
          <a href="https://explorer.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">
            Explorer
          </a>
          <a href="https://faucet.testnet.chain.robinhood.com/" target="_blank" rel="noreferrer">
            Faucet
          </a>
        </footer>

        <HowItWorksModal open={how} onClose={() => setHow(false)} />
      </div>
    </HowCtx.Provider>
  )
}
