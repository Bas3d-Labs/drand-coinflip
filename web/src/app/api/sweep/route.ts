import { NextResponse } from 'next/server'
import { relayerEnabled, relayerInfo, sweep } from '@/server/relayer'

export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

/** Cron sweep (vercel.json). Protected by CRON_SECRET when set; Vercel sends it as a Bearer token. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ status: 'unauthorized' }, { status: 401 })
  if (!relayerEnabled()) return NextResponse.json({ status: 'relayer-disabled' }, { status: 503 })
  const [info, res] = await Promise.all([relayerInfo(), sweep()])
  if (info.enabled && info.low) console.warn(`[sweep] relayer balance low: ${info.balanceEth} ETH (${info.address})`)
  return NextResponse.json({ relayer: info, ...res })
}
