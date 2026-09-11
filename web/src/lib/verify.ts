import type { Address } from 'viem'
import { beaconRandomness, bounded, computeSeed, fetchBeacon, type DrandBeacon } from './drand'
import type { FlipRow } from '../hooks/useFlips'

export type Verification = {
  beacon: DrandBeacon
  computedRandomness: `0x${string}`
  computedSeed: `0x${string}`
  computedResult: number
  randomnessOk: boolean
  seedOk: boolean
  resultOk: boolean
  ok: boolean
}

/**
 * Independently re-derive a settled flip from public inputs only:
 *   1. fetch round R's BLS signature from drand's public API
 *   2. sha256(signature) must equal the randomness the contract recorded
 *   3. keccak(seedDomain, tag, chainId, contract, bytes32(id), round, randomness) must equal the recorded seed
 *   4. seed -> bounded(seed, 2) must equal the recorded result
 */
export async function verifyFlip(chainId: number, contract: Address, f: FlipRow): Promise<Verification> {
  if (!f.settled) throw new Error('flip not settled yet')
  const beacon = await fetchBeacon(f.targetRound)
  const computedRandomness = await beaconRandomness(beacon.signature)
  const computedSeed = computeSeed(chainId, contract, f.id, BigInt(f.targetRound), computedRandomness)
  const computedResult = Number(bounded(computedSeed, 2n))
  const randomnessOk = computedRandomness.toLowerCase() === f.randomness.toLowerCase()
  const seedOk = computedSeed.toLowerCase() === f.seed.toLowerCase()
  const resultOk = computedResult === f.result
  return { beacon, computedRandomness, computedSeed, computedResult, randomnessOk, seedOk, resultOk, ok: randomnessOk && seedOk && resultOk }
}
