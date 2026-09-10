import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import { cookieToInitialState } from 'wagmi'
import { Providers } from './providers'
import { Shell } from '@/components/Shell'
import { wagmiConfig } from '@/config/wagmi'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'drand Coin Flip · Robinhood Chain Testnet',
  description: 'A provably fair coin flip powered by drand Quicknet, verified on-chain.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = { themeColor: '#07080c', width: 'device-width', initialScale: 1 }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialState = cookieToInitialState(wagmiConfig, (await headers()).get('cookie'))
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <Providers initialState={initialState}>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  )
}
