'use client'
import { useState } from 'react'
import { WagmiProvider, type State } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiConfig } from '@/config/wagmi'

export function Providers({ children, initialState }: { children: React.ReactNode; initialState?: State }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, refetchOnWindowFocus: false } } }))
  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  )
}
