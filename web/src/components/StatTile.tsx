'use client'
export function StatTile({ label, value, sub, hero, bar }: { label: string; value: string; sub?: string; hero?: boolean; bar?: number }) {
  return (
    <div className="card tile">
      <div className="tile-label">{label}</div>
      <div className={'tile-value' + (hero ? ' hero' : '')}>{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
      {bar !== undefined && (
        <div className="tile-bar" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
        </div>
      )}
    </div>
  )
}
