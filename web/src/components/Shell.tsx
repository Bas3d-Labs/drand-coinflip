'use client'
import { createContext, useContext, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'
import { HowItWorksModal } from './HowItWorksModal'
import { IS_DEPLOYED } from '@/config/deployments'
import { REPO_URL } from '@/config/links'

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}

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
            <a
              className="icon-btn"
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              aria-label="drand-quicknet-evm on GitHub"
              title="drand-quicknet-evm on GitHub"
            >
              <GitHubIcon />
            </a>
            <button className="icon-btn" onClick={() => setHow(true)} aria-label="How it works" title="How it works">
              <HelpIcon />
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
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </footer>

        <HowItWorksModal open={how} onClose={() => setHow(false)} />
      </div>
    </HowCtx.Provider>
  )
}
