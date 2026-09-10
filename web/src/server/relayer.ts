/**
 * Server-side settlement for DrandCoinFlip. Used by:
 *   POST /api/settle  – the client nudges this once a flip's drand round is public
 *   GET  /api/sweep   – cron sweeps anything left unsettled
 *
 * Anyone may settle a flip; the outcome is a pure function of the committed round, so this
 * key can never influence results. It only spends gas on flips that are genuinely due.
 */
import { createPublicClient, createWalletClient, http, formatEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { robinhoodTestnet } from '@/config/chain'
import { COINFLIP_ADDRESS, IS_DEPLOYED } from '@/config/deployments'
import { coinFlipAbi } from '@/contracts/abis'
import { fetchBeacon, roundScheduledTime } from '@/lib/drand'

const rpcUrl = process.env.RELAYER_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || robinhoodTestnet.rpcUrls.default.http[0]

export type SettleResult =
  | { id: string; status: 'settled'; hash: Hex; block: string; gasUsed: string }
  | { id: string; status: 'already-settled' | 'not-due' | 'beacon-unavailable' | 'unknown-flip' | 'error'; detail?: string }

export function relayerEnabled() {
  return IS_DEPLOYED && !!process.env.RELAYER_PRIVATE_KEY
}

function clients() {
  const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY as Hex)
  const pub = createPublicClient({ chain: robinhoodTestnet, transport: http(rpcUrl) })
  const wallet = createWalletClient({ chain: robinhoodTestnet, transport: http(rpcUrl), account })
  return { account, pub, wallet }
}

export async function relayerInfo() {
  if (!relayerEnabled()) return { enabled: false as const }
  const { account, pub } = clients()
  const bal = await pub.getBalance({ address: account.address })
  return { enabled: true as const, address: account.address, balanceEth: formatEther(bal), low: bal < 1_000_000_000_000_000n / 10n }
}

/** Settle one flip, retrying on nonce collisions (several invocations may share this key). */
export async function settleFlip(id: bigint): Promise<SettleResult> {
  const { account, pub, wallet } = clients()
  const key = id.toString()
  let f
  try {
    f = await pub.readContract({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'getFlip', args: [id] })
  } catch {
    return { id: key, status: 'unknown-flip' }
  }
  if (f.settled) return { id: key, status: 'already-settled' }
  if (Date.now() / 1000 < roundScheduledTime(f.targetRound) + 1) return { id: key, status: 'not-due' }

  let sig: Hex
  try {
    sig = ('0x' + (await fetchBeacon(f.targetRound)).signature) as Hex
  } catch (e) {
    return { id: key, status: 'beacon-unavailable', detail: String((e as Error).message) }
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { request } = await pub.simulateContract({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'settleWithBeacon', args: [id, sig], account })
      const nonce = await pub.getTransactionCount({ address: account.address, blockTag: 'pending' })
      const hash = await wallet.writeContract({ ...request, nonce })
      const rc = await pub.waitForTransactionReceipt({ hash, timeout: 25_000 })
      return { id: key, status: rc.status === 'success' ? 'settled' : 'error', hash, block: rc.blockNumber.toString(), gasUsed: rc.gasUsed.toString() }
    } catch (e) {
      const msg = String((e as { shortMessage?: string; message?: string }).shortMessage ?? (e as Error).message ?? e)
      if (/AlreadySettled/.test(msg)) return { id: key, status: 'already-settled' }
      if (/nonce|replacement|already known/i.test(msg) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 400 + Math.random() * 800))
        continue
      }
      return { id: key, status: 'error', detail: msg.split('\n')[0].slice(0, 300) }
    }
  }
  return { id: key, status: 'error', detail: 'gave up after nonce retries' }
}

/** Settle every due-but-unsettled flip, oldest first. Bounded so it fits a serverless budget. */
export async function sweep(max = 8): Promise<{ scanned: number; results: SettleResult[] }> {
  const { pub } = clients()
  const count = await pub.readContract({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'flipCount' })
  const window = 400n
  const from = count > window ? count - window : 0n
  const flips = await pub.readContract({ address: COINFLIP_ADDRESS, abi: coinFlipAbi, functionName: 'getFlips', args: [from, count] })
  const now = Date.now() / 1000
  const due: bigint[] = []
  flips.forEach((f, i) => {
    if (!f.settled && now >= roundScheduledTime(f.targetRound) + 1) due.push(from + BigInt(i))
  })
  const results: SettleResult[] = []
  for (const id of due.slice(0, max)) results.push(await settleFlip(id))
  return { scanned: flips.length, results }
}
