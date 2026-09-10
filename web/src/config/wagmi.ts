import { createConfig, http, cookieStorage, createStorage } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { robinhoodTestnet } from './chain'
import { devBurnerConnector } from './devConnector'

/** Dev overrides: NEXT_PUBLIC_RPC_URL points at a local anvil fork; NEXT_PUBLIC_DEV_PRIVATE_KEY adds a
 *  wallet-less "burner" connector (dev builds only) for driving the app without an extension. */
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0]
const devKey = process.env.NODE_ENV !== 'production' ? (process.env.NEXT_PUBLIC_DEV_PRIVATE_KEY as `0x${string}` | undefined) : undefined

export const wagmiConfig = createConfig({
  chains: [robinhoodTestnet],
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
  connectors: [injected(), ...(devKey ? [devBurnerConnector(devKey, rpcUrl)] : [])],
  transports: {
    [robinhoodTestnet.id]: http(rpcUrl, { batch: true }),
  },
  multiInjectedProviderDiscovery: true,
})

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig
  }
}
