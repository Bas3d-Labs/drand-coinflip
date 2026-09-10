/**
 * Minimal drand relayer + settler for DrandCoinFlip.
 *
 * Loop every 3 s:
 *   - read flipCount, scan any flips not yet settled
 *   - once a flip's target round is public on api.drand.sh, fetch the signature and call
 *     settleWithBeacon(id, sig) (imports the beacon into the registry if needed, then settles)
 *
 * This means the player never has to be the one who reveals: the outcome lands on-chain
 * whether or not they come back. Anyone can run this; the outcome cannot depend on who does.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createPublicClient, createWalletClient, http, defineChain, parseAbi, formatEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const GENESIS = 1692803367
const PERIOD = 3
const DRAND = 'https://api.drand.sh/v2/beacons/quicknet/rounds'

const chain = defineChain({
  id: 46630,
  name: 'Robinhood Chain Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [process.env.RPC_URL ?? 'https://rpc.testnet.chain.robinhood.com'] } },
})

const abi = parseAbi([
  'function flipCount() view returns (uint256)',
  'function getFlips(uint256 from, uint256 to) view returns ((address player,uint8 choice,uint8 result,bool settled,uint64 targetRound,uint64 commitTime,uint64 settleTime,bytes32 randomness,bytes32 seed)[])',
  'function settleWithBeacon(uint256 id, bytes signature)',
  'function settle(uint256 id)',
  'event FlipSettled(uint256 indexed id,address indexed player,uint64 targetRound,bytes32 randomness,bytes32 seed,uint8 result,bool won,address settler)',
])

function loadAddress() {
  if (process.env.COINFLIP_ADDRESS) return process.env.COINFLIP_ADDRESS
  const p = path.resolve(new URL('.', import.meta.url).pathname, '../web/src/config/deployments.json')
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'))
  return cfg['46630']?.coinFlip
}

const address = loadAddress()
if (!address || address.length !== 42) throw new Error('COINFLIP_ADDRESS not set and no deployment found')
if (!process.env.RELAYER_PRIVATE_KEY) throw new Error('RELAYER_PRIVATE_KEY not set')

const account = privateKeyToAccount(process.env.RELAYER_PRIVATE_KEY)
const pub = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ chain, transport: http(), account })

const roundTime = (r) => GENESIS + (Number(r) - 1) * PERIOD
let scanFrom = 0n // ids below this are known settled

async function fetchSig(round) {
  const res = await fetch(`${DRAND}/${round}`, { cache: 'no-store' })
  if (!res.ok) return null
  const j = await res.json()
  return '0x' + j.signature
}

async function settleOne(id, f) {
  try {
    const sig = await fetchSig(f.targetRound)
    if (!sig) return
    const { request } = await pub.simulateContract({ address, abi, functionName: 'settleWithBeacon', args: [id, sig], account })
    const hash = await wallet.writeContract(request)
    console.log(`[flip #${id}] round ${f.targetRound} -> settleWithBeacon ${hash}`)
    const rc = await pub.waitForTransactionReceipt({ hash })
    console.log(`[flip #${id}] ${rc.status} in block ${rc.blockNumber} (gas ${rc.gasUsed})`)
  } catch (e) {
    const msg = String(e?.shortMessage ?? e?.message ?? e)
    if (/AlreadySettled/.test(msg)) console.log(`[flip #${id}] already settled by someone else`)
    else console.error(`[flip #${id}] error: ${msg.split('\n')[0]}`)
  }
}

let ticking = false

async function tick() {
  if (ticking) return
  ticking = true
  try {
    const count = await pub.readContract({ address, abi, functionName: 'flipCount' })
    if (count === scanFrom) return
    const base = scanFrom
    const flips = await pub.readContract({ address, abi, functionName: 'getFlips', args: [base, count] })
    const now = Math.floor(Date.now() / 1000)
    let allSettledPrefix = true
    const due = []
    flips.forEach((f, i) => {
      const id = base + BigInt(i)
      if (f.settled) {
        if (allSettledPrefix) scanFrom = id + 1n
        return
      }
      allSettledPrefix = false
      if (now >= roundTime(f.targetRound) + 1) due.push([id, f])
    })
    // One signer => settle sequentially so nonces never collide.
    for (const [id, f] of due) await settleOne(id, f)
  } finally {
    ticking = false
  }
}

console.log(`relayer ${account.address} watching DrandCoinFlip ${address} on chain ${chain.id}`)
pub.getBalance({ address: account.address }).then((b) => console.log(`balance ${formatEther(b)} ETH`))
setInterval(() => tick().catch((e) => console.error('tick error', e?.shortMessage ?? e?.message ?? e)), 3000)
tick()
