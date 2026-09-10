/**
 * drand Quicknet helpers. All numbers here are the public beacon schedule:
 *   round R is published at GENESIS + (R - 1) * PERIOD seconds.
 */
import { keccak256, encodeAbiParameters, type Hex, type Address } from 'viem'

export const QUICKNET_GENESIS = 1692803367
export const QUICKNET_PERIOD = 3
export const QUICKNET_CHAIN_HASH = '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971'
export const QUICKNET_PUBLIC_KEY =
  '83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a'

export const DRAND_API = 'https://api.drand.sh/v2/beacons/quicknet'
/** Independent HTTP relays for the same beacon (League of Entropy). Tried in order. */
export const DRAND_MIRRORS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh'] as const

export function roundScheduledTime(round: number | bigint): number {
  return QUICKNET_GENESIS + (Number(round) - 1) * QUICKNET_PERIOD
}

export function roundAt(timestampSec: number): number {
  if (timestampSec < QUICKNET_GENESIS) return 0
  return Math.floor((timestampSec - QUICKNET_GENESIS) / QUICKNET_PERIOD) + 1
}

export function drandRoundUrl(round: number | bigint): string {
  return `${DRAND_API}/rounds/${round}`
}

export type DrandBeacon = { round: number; signature: string }

/** Fetch a beacon from the public drand API. Throws while the round is still in the future. */
export async function fetchBeacon(round: number | bigint, signal?: AbortSignal): Promise<DrandBeacon> {
  let lastErr: unknown
  for (const host of DRAND_MIRRORS) {
    try {
      const res = await fetch(`${host}/v2/beacons/quicknet/rounds/${round}`, { signal, cache: 'no-store' })
      if (!res.ok) throw new Error(`drand round ${round} not available yet (HTTP ${res.status})`)
      const json = (await res.json()) as DrandBeacon
      if (Number(json.round) !== Number(round) || !json.signature || json.signature.length !== 96) throw new Error('unexpected drand response')
      return json
    } catch (e) {
      lastErr = e
      if (signal?.aborted) throw e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`drand round ${round} unavailable`)
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): Hex {
  return ('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex
}

/** The registry stores sha256(signature) as the round's randomness. */
export async function beaconRandomness(signatureHex: string): Promise<Hex> {
  const digest = await crypto.subtle.digest('SHA-256', hexToBytes(signatureHex) as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

export const DOMAIN_TAG = keccak256(new TextEncoder().encode('DRAND_COINFLIP_V1'))

/** Mirrors DrandCoinFlip.computeSeed: keccak256(abi.encode(tag, chainid, contract, id, uint16(0), randomness)). */
export function computeSeed(chainId: number, contract: Address, id: bigint, randomness: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint16' }, { type: 'bytes32' }],
      [DOMAIN_TAG, BigInt(chainId), contract, id, 0, randomness],
    ),
  )
}

const MAX = (1n << 256n) - 1n

/** Mirrors DrandCoinFlip.bounded: rejection sampling, never a biased modulo. */
export function bounded(seed: Hex, n: bigint): bigint {
  const limit = MAX - (MAX % n)
  let s = seed
  for (;;) {
    const v = BigInt(s)
    if (v < limit) return v % n
    s = keccak256(encodeAbiParameters([{ type: 'bytes32' }], [s]))
  }
}

export type Side = 0 | 1
export const SIDE_LABEL: Record<Side, string> = { 0: 'Heads', 1: 'Tails' }
