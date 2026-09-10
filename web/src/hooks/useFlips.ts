'use client'
import { useMemo } from 'react'
import { useReadContract, useReadContracts } from 'wagmi'
import type { Address, Hex } from 'viem'
import { coinFlipAbi } from '../contracts/abis'
import { COINFLIP_ADDRESS, IS_DEPLOYED } from '../config/deployments'
import type { Side } from '../lib/drand'

export type FlipRow = {
  id: bigint
  player: Address
  choice: Side
  result: Side
  settled: boolean
  targetRound: bigint
  commitTime: bigint
  settleTime: bigint
  randomness: Hex
  seed: Hex
}

const PAGE = 400n

export function useFlipCount(refetchInterval = 4000) {
  return useReadContract({
    address: COINFLIP_ADDRESS,
    abi: coinFlipAbi,
    functionName: 'flipCount',
    query: { enabled: IS_DEPLOYED, refetchInterval, refetchIntervalInBackground: true },
  })
}

/** Every flip in the on-chain log, oldest first. Polls so the dashboard stays live. */
export function useAllFlips(refetchInterval = 4000) {
  const count = useFlipCount(refetchInterval)
  const total = count.data ?? 0n
  const pages = useMemo(() => {
    const out: { from: bigint; to: bigint }[] = []
    for (let from = 0n; from < total; from += PAGE) out.push({ from, to: from + PAGE > total ? total : from + PAGE })
    return out
  }, [total])

  const reads = useReadContracts({
    contracts: pages.map((p) => ({
      address: COINFLIP_ADDRESS,
      abi: coinFlipAbi,
      functionName: 'getFlips' as const,
      args: [p.from, p.to] as const,
    })),
    query: { enabled: IS_DEPLOYED && pages.length > 0, refetchInterval, refetchIntervalInBackground: true },
  })

  const flips = useMemo<FlipRow[]>(() => {
    if (!reads.data) return []
    const out: FlipRow[] = []
    reads.data.forEach((r, pi) => {
      if (r.status !== 'success') return
      const base = pages[pi].from
      ;(r.result as readonly Omit<FlipRow, 'id'>[]).forEach((f, i) => {
        out.push({ ...f, id: base + BigInt(i) })
      })
    })
    return out
  }, [reads.data, pages])

  return { flips, total, isLoading: count.isLoading || reads.isLoading, refetch: reads.refetch, error: count.error ?? reads.error }
}

export function useFlip(id: bigint | undefined, refetchInterval: number | false = 2500) {
  return useReadContract({
    address: COINFLIP_ADDRESS,
    abi: coinFlipAbi,
    functionName: 'getFlip',
    args: id === undefined ? undefined : [id],
    query: { enabled: IS_DEPLOYED && id !== undefined, refetchInterval, refetchIntervalInBackground: true },
  })
}

export function useFlipStatus(id: bigint | undefined, refetchInterval: number | false = 2500) {
  return useReadContract({
    address: COINFLIP_ADDRESS,
    abi: coinFlipAbi,
    functionName: 'flipStatus',
    args: id === undefined ? undefined : [id],
    query: { enabled: IS_DEPLOYED && id !== undefined, refetchInterval, refetchIntervalInBackground: true },
  })
}
