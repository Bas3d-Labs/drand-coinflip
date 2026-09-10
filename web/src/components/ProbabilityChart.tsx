'use client'
import { useMemo } from 'react'
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts'
import type { FlipRow } from '../hooks/useFlips'

type Point = { n: number; p: number; band: [number, number]; heads: number; id: number }

/**
 * Running share of Heads after each settled flip, with the 95% interval a fair coin would
 * produce at that sample size (±1.96·sqrt(0.25/n)). A fair beacon keeps the line inside the band.
 */
export function ProbabilityChart({ flips }: { flips: FlipRow[] }) {
  const data = useMemo<Point[]>(() => {
    const settled = flips.filter((f) => f.settled).sort((a, b) => Number(a.settleTime - b.settleTime) || Number(a.id - b.id))
    let heads = 0
    return settled.map((f, i) => {
      if (f.result === 0) heads++
      const n = i + 1
      const half = 1.96 * Math.sqrt(0.25 / n)
      return { n, p: heads / n, band: [Math.max(0, 0.5 - half), Math.min(1, 0.5 + half)], heads, id: Number(f.id) }
    })
  }, [flips])

  if (data.length === 0) return <div className="empty">No settled flips yet. Flip a coin to start the series.</div>

  return (
    <div style={{ width: '100%', height: 300 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="n" tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickLine={false} label={{ value: 'settled flips', position: 'insideBottomRight', fill: 'var(--text-3)', fontSize: 11, dy: 8 }} />
          <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v) => `${Math.round(v * 100)}%`} tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Tooltip
            cursor={{ stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const d = payload[0].payload as Point
              return (
                <div className="tooltip">
                  <div>After flip <b>#{d.id}</b> · n = <b>{d.n}</b></div>
                  <div>Heads share <b>{(d.p * 100).toFixed(1)}%</b> ({d.heads}/{d.n})</div>
                  <div style={{ color: 'var(--text-3)' }}>fair band {(d.band[0] * 100).toFixed(0)}–{(d.band[1] * 100).toFixed(0)}%</div>
                </div>
              )
            }}
          />
          <Area type="monotone" dataKey="band" stroke="none" fill="var(--series-1)" fillOpacity={0.12} isAnimationActive={false} />
          <ReferenceLine y={0.5} stroke="var(--text-3)" strokeWidth={1} />
          <Line type="monotone" dataKey="p" stroke="var(--series-1)" strokeWidth={2} dot={data.length <= 60 ? { r: 3, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 } : false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
