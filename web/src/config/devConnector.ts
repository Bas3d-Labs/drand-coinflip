/**
 * DEV ONLY. A wallet-less EIP-1193 provider backed by a local private key, so the app can be
 * driven end-to-end against an anvil fork without a browser extension. Never ships in prod:
 * it is only created outside production builds when NEXT_PUBLIC_DEV_PRIVATE_KEY is set.
 */
import { createWalletClient, http, type EIP1193Provider, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { injected } from 'wagmi/connectors'
import { robinhoodTestnet } from './chain'

export function devBurnerConnector(privateKey: Hex, rpcUrl: string) {
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: robinhoodTestnet, transport: http(rpcUrl) })
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>()

  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account.address]
        case 'eth_chainId':
          return `0x${robinhoodTestnet.id.toString(16)}`
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          return null
        case 'eth_sendTransaction': {
          const tx = (params as [Record<string, Hex>])[0]
          return wallet.sendTransaction({
            to: tx.to,
            data: tx.data,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          })
        }
        case 'personal_sign':
          return account.signMessage({ message: { raw: (params as [Hex])[0] } })
        default:
          return wallet.request({ method, params } as never)
      }
    },
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    removeListener(event: string, fn: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(fn)
    },
  } as unknown as EIP1193Provider

  return injected({
    target: { id: 'devBurner', name: `Dev burner (${account.address.slice(0, 6)}…)`, provider },
    shimDisconnect: true,
  })
}
