'use client'
import { useMemo } from 'react'
import { StatTile } from '../components/StatTile'
import { ProbabilityChart } from '../components/ProbabilityChart'
import { FlipLog } from '../components/FlipLog'
import { useAllFlips } from '../hooks/useFlips'
import { explorerAddr, pct } from '../lib/format'
import { COINFLIP_ADDRESS } from '../config/deployments'
import { REGISTRY_ADDRESS } from '../config/chain'

export default function DashboardPage() {
  const { flips, isLoading, error } = useAllFlips(4000)

  const stats = useMemo(() => {
    const settled = flips.filter((f) => f.settled)
    const heads = settled.filter((f) => f.result === 0).length
    const wins = settled.filter((f) => f.result === f.choice).length
    const n = settled.length
    const se = n ? Math.sqrt(0.25 / n) : 0
    const z = n ? (heads / n - 0.5) / se : 0
    return { total: flips.length, settled: n, pending: flips.length - n, heads, tails: n - heads, wins, z }
  }, [flips])

  return (
    <div>
      <h1>Randomness dashboard</h1>
      <p className="lede">Every flip and the drand round it used. Verify recomputes any result in your browser.</p>

      <div className="tiles">
        <StatTile label="Total flips" value={stats.total.toLocaleString()} sub={`${stats.pending} awaiting beacon`} hero />
        <StatTile label="Settled" value={stats.settled.toLocaleString()} sub="resolved from a verified beacon" />
        <StatTile label="Heads share" value={stats.settled ? pct(stats.heads / stats.settled) : '—'} sub={`${stats.heads} heads · ${stats.tails} tails`} bar={stats.settled ? stats.heads / stats.settled : 0} />
        <StatTile label="Deviation from fair" value={stats.settled ? `${stats.z >= 0 ? '+' : ''}${stats.z.toFixed(2)}σ` : '—'} sub={Math.abs(stats.z) < 1.96 ? 'within 95% band' : Math.abs(stats.z) < 3 ? 'outside 95% band' : 'outside 99.7% band'} />
        <StatTile label="Player win rate" value={stats.settled ? pct(stats.wins / stats.settled) : '—'} sub="called side matched result" />
      </div>

      <div className="card chart-wrap">
        <div className="chart-head">
          <div>
            <h2>Running share of Heads</h2>
            <div className="chart-sub">Cumulative after each settled flip. Shaded band is the 95% interval for a fair coin at that sample size.</div>
          </div>
          <div className="chart-legend">
            <span><i className="swatch" /> heads share</span>
            <span><i className="swatch band" /> fair-coin 95% band</span>
            <span><i className="swatch ref" /> 50%</span>
          </div>
        </div>
        {error ? <div className="error">{error.message.split('\n')[0]}</div> : isLoading ? <div className="empty">Loading…</div> : <ProbabilityChart flips={flips} />}
      </div>

      <FlipLog flips={flips} />

      <div className="card" style={{ marginTop: 22 }}>
        <p className="card-title">Contracts on Robinhood Chain Testnet (46630)</p>
        <dl className="kv">
          <dt>DrandCoinFlip</dt>
          <dd><a href={explorerAddr(COINFLIP_ADDRESS)} target="_blank" rel="noreferrer">{COINFLIP_ADDRESS || 'not deployed'}</a></dd>
          <dt>Beacon registry</dt>
          <dd><a href={explorerAddr(REGISTRY_ADDRESS)} target="_blank" rel="noreferrer">{REGISTRY_ADDRESS}</a></dd>
          <dt>Beacon source</dt>
          <dd><a href="https://api.drand.sh/v2/beacons/quicknet/info" target="_blank" rel="noreferrer">drand Quicknet (period 3s, unchained, BLS12-381 G1)</a></dd>
        </dl>
      </div>
    </div>
  )
}
