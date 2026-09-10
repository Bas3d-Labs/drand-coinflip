export const short = (a: string, n = 4) => (a ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : '')
export const shortHash = (h: string) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : '')
export const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`
export const ts = (t: bigint | number) => {
  const n = Number(t)
  if (!n) return '—'
  return new Date(n * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
export const explorerTx = (h: string) => `https://explorer.testnet.chain.robinhood.com/tx/${h}`
export const explorerAddr = (a: string) => `https://explorer.testnet.chain.robinhood.com/address/${a}`
