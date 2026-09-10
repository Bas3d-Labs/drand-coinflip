import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const cf = JSON.parse(fs.readFileSync(path.join(root, 'contracts/out/DrandCoinFlip.sol/DrandCoinFlip.json'))).abi
const reg = JSON.parse(fs.readFileSync(path.join(root, 'contracts/out/IDrandQuicknetBeaconRegistry.sol/IDrandQuicknetBeaconRegistry.json'))).abi
const out = `// Generated from contracts/out by \`pnpm sync-abi\`. Do not edit by hand.
export const coinFlipAbi = ${JSON.stringify(cf, null, 2)} as const

export const registryAbi = ${JSON.stringify(reg, null, 2)} as const
`
fs.writeFileSync(path.join(root, 'web/src/contracts/abis.ts'), out)
console.log('wrote web/src/contracts/abis.ts')
