'use client'
import { useCallback, useRef } from 'react'

export type CoinState = 'idle' | 'arming' | 'tossing' | 'tossing-fast' | 'heads' | 'tails'

const SPARKS = Array.from({ length: 22 }, (_, i) => ({
  a: `${(360 / 22) * i + (i % 2 ? 9 : -7)}deg`,
  d: `${110 + ((i * 41) % 90)}px`,
  dl: `${(i % 6) * 40}ms`,
}))

const CLS: Record<CoinState, string> = {
  idle: 'coin-scene idle',
  arming: 'coin-scene arming',
  tossing: 'coin-scene tossing',
  'tossing-fast': 'coin-scene tossing fast',
  heads: 'coin-scene landed heads',
  tails: 'coin-scene landed tails',
}

/**
 * Metallic 3D coin. Layers, outer to inner:
 *   .coin-toss  vertical arc (toss / drop / float)
 *   .coin-tilt  slow precession while airborne, pointer-follow while idle
 *   .coin       end-over-end tumble and the final landing turn
 * All motion lives in CSS keyed off the state class; see globals.css.
 */
export function Coin({ state }: { state: CoinState }) {
  const ref = useRef<HTMLDivElement>(null)

  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (state !== 'idle' || !ref.current || e.pointerType === 'touch') return
      const r = ref.current.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      ref.current.style.setProperty('--px', `${(x * 34).toFixed(1)}deg`)
      ref.current.style.setProperty('--py', `${(-y * 26).toFixed(1)}deg`)
      ref.current.style.setProperty('--gx', `${(50 + x * 40).toFixed(1)}%`)
      ref.current.style.setProperty('--gy', `${(50 + y * 40).toFixed(1)}%`)
    },
    [state],
  )
  const onLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--px', '0deg')
    el.style.setProperty('--py', '0deg')
    el.style.setProperty('--gx', '32%')
    el.style.setProperty('--gy', '26%')
  }, [])

  return (
    <div ref={ref} className={CLS[state]} aria-label={`coin ${state}`} role="img" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className="coin-shadow" />
      <div className="land-ring" />
      <div className="coin-toss">
        <div className="coin-tilt">
          <div className="coin">
            <div className="face front">
              <span className="face-stars">✦ ✦ ✦</span>
              <span className="face-glyph">H</span>
              <span className="face-label">Heads</span>
              <span className="face-spec" />
              <span className="face-sheen" />
            </div>
            <div className="face back">
              <span className="face-stars">✦ ✦ ✦</span>
              <span className="face-glyph">T</span>
              <span className="face-label">Tails</span>
              <span className="face-spec" />
              <span className="face-sheen" />
            </div>
            <Edge />
          </div>
        </div>
      </div>
      <div className="sparks" aria-hidden="true">
        {SPARKS.map((s, i) => (
          <i key={i} style={{ '--a': s.a, '--d': s.d, '--dl': s.dl } as React.CSSProperties} />
        ))}
      </div>
    </div>
  )
}

/** Thickness: a stack of thin reeded discs strictly between the two faces. */
function Edge() {
  const n = 10
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const z = -4.5 + (9 / (n - 1)) * i
        return <div key={i} className={'edge' + (i % 2 ? ' edge-r' : '')} style={{ transform: `translateZ(${z.toFixed(2)}px)` }} />
      })}
    </>
  )
}
