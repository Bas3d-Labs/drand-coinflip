import { defineChain } from 'viem'

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.testnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Robinhood Testnet Explorer',
      url: 'https://explorer.testnet.chain.robinhood.com',
      apiUrl: 'https://explorer.testnet.chain.robinhood.com/api',
    },
  },
  testnet: true,
})

export const FAUCET_URL = 'https://faucet.testnet.chain.robinhood.com/'

/** Verified drand Quicknet beacon registry on Robinhood Chain Testnet. */
export const REGISTRY_ADDRESS = '0x6e69C56D8D678aDeF8401adF1186c026A0915e2a' as const
export const VERIFIER_ADDRESS = '0x90427e40e7D6f60425D29474a85595C4d8EE6B95' as const
