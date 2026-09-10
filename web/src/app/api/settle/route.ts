import { NextResponse } from 'next/server'
import { relayerEnabled, settleFlip } from '@/server/relayer'

export const runtime = 'nodejs'
export const maxDuration = 60

/** Client nudge: settle one flip whose drand round is now public. Idempotent. */
export async function POST(req: Request) {
  if (!relayerEnabled()) return NextResponse.json({ status: 'relayer-disabled' }, { status: 503 })
  let id: bigint
  try {
    const body = (await req.json()) as { id?: string | number }
    id = BigInt(body.id as string)
    if (id < 0n) throw new Error()
  } catch {
    return NextResponse.json({ status: 'bad-request' }, { status: 400 })
  }
  const result = await settleFlip(id)
  const code = result.status === 'settled' || result.status === 'already-settled' ? 200 : result.status === 'not-due' || result.status === 'beacon-unavailable' ? 425 : result.status === 'unknown-flip' ? 404 : 502
  return NextResponse.json(result, { status: code })
}
