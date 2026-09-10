import type { Address } from 'viem'
import deployments from './deployments.json'
import { robinhoodTestnet } from './chain'

type Deployment = { coinFlip: string; registry: string; leadRounds: number; deployBlock: number }

const d = (deployments as Record<string, Deployment>)[String(robinhoodTestnet.id)]
const envAddress = process.env.NEXT_PUBLIC_COINFLIP_ADDRESS

export const COINFLIP_ADDRESS = ((envAddress && envAddress.length === 42 ? envAddress : d?.coinFlip) || '') as Address
export const COINFLIP_DEPLOY_BLOCK = BigInt(d?.deployBlock ?? 0)
export const LEAD_ROUNDS = d?.leadRounds ?? 4
export const IS_DEPLOYED = COINFLIP_ADDRESS.length === 42
