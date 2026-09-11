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

/**
 * drand Quicknet beacon registry + verifier on Robinhood Chain Testnet.
 * Source of truth: drand-quicknet-evm/deployments/robinhood-testnet.json (pinned submodule in contracts/lib).
 * The CoinFlip contract authenticates the registry's runtime codehash at construction.
 */
export const REGISTRY_ADDRESS = '0xB1e8bc94AdBb82F036aafC2Af004986F810dd0fe' as const
export const REGISTRY_CODEHASH = '0x6d84157b97cfea3d51931f84f17638028dff7560d9be1f07c9d668fa37480e73' as const
export const VERIFIER_ADDRESS = '0xAe9a1AbF0D30633ec1Eb73038F375b2c7Ee0E01e' as const
export const VERIFIER_CODEHASH = '0x916ebb69c0ceb4c049d50ad8bf5b3e566661a2b1ef33e01727ed443673b68aab' as const
