import { jobsearchHealth } from '@/services/jobsearch'
import { useEffect, useState } from 'react'

/**
 * Shared health poll for all Jobs modules (Search / Auto / Night / Playbooks).
 * 30s interval — one subscription pattern, not three divergent pings.
 */
export function useJobLabHealth(lab: boolean) {
  const [apiOk, setApiOk] = useState(false)
  const [connectivity, setConnectivity] = useState('Checking…')

  useEffect(() => {
    if (!lab) return
    const ping = () => {
      void jobsearchHealth().then((h) => {
        setApiOk(Boolean(h.ok && (h.enabled ?? h.lab_enabled) !== false))
        if (!h.ok) {
          setConnectivity(h.error || 'API offline')
          return
        }
        const open = h.enterprise?.open_breakers?.length
          ? h.enterprise.open_breakers
          : h.enterprise?.slo?.open_breakers || []
        const grade = h.grade || h.enterprise?.grade
        const ver = h.version ? `v${h.version}` : ''
        if (open.length) {
          setConnectivity(
            `${grade === 'enterprise' ? 'Enterprise' : 'API'} ${ver} · ${open.length} board(s) cooling`.trim(),
          )
          return
        }
        const fh = h.connectivity?.freehire
        const cacheHit =
          typeof h.enterprise?.cache?.hit_rate === 'number'
            ? ` · cache ${Math.round((h.enterprise.cache.hit_rate || 0) * 100)}%`
            : ''
        setConnectivity(
          fh?.ok === false
            ? `Boards limited${cacheHit}`
            : `${grade === 'enterprise' ? 'Enterprise ready' : 'Live boards ready'}${ver ? ` ${ver}` : ''}${cacheHit}`,
        )
      })
    }
    ping()
    const id = window.setInterval(ping, 30_000)
    return () => window.clearInterval(id)
  }, [lab])

  return { apiOk, connectivity, setApiOk, setConnectivity }
}
