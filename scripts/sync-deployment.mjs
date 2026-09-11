// Reads the latest forge broadcast for chain 46630 and writes the address into the web config.
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const chainId = process.argv[2] ?? '46630'
const runPath = path.join(root, `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`)
if (!fs.existsSync(runPath)) {
  console.error(`No broadcast found at ${runPath}. Deploy first.`)
  process.exit(1)
}
const run = JSON.parse(fs.readFileSync(runPath, 'utf8'))
const tx = run.transactions.find((t) => t.transactionType === 'CREATE' && t.contractName === 'DrandCoinFlip')
if (!tx) throw new Error('DrandCoinFlip CREATE not found in broadcast')
const receipt = run.receipts.find((r) => r.transactionHash === tx.hash)
const [registry, registryCodehash, lead] = tx.arguments ?? []
const cfgPath = path.join(root, 'web/src/config/deployments.json')
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
cfg[chainId] = {
  coinFlip: tx.contractAddress,
  registry: registry ?? cfg[chainId]?.registry,
  registryCodehash: registryCodehash ?? cfg[chainId]?.registryCodehash,
  leadRounds: lead ? Number(lead) : cfg[chainId]?.leadRounds,
  deployBlock: receipt ? Number(receipt.blockNumber) : 0,
  deployTx: tx.hash,
}
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n')
console.log(`DrandCoinFlip @ ${tx.contractAddress} (block ${cfg[chainId].deployBlock}) written to web/src/config/deployments.json`)
