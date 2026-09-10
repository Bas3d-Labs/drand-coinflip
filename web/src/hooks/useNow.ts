'use client'
import { useEffect, useState } from 'react'

/** Wall-clock seconds, ticking. */
export function useNow(intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
