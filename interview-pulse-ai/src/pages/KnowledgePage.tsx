import { MaterialsPanel } from '@/components/MaterialsPanel'
import { useAppStore } from '@/stores/app-store'
import { useEffect } from 'react'

/**
 * Legacy Knowledge route — redirects into unified Interview + Materials.
 * Kept so deep links and old bookmarks never 404.
 */
export function KnowledgePage() {
  const setRoute = useAppStore((s) => s.setRoute)

  useEffect(() => {
    setRoute('knowledge') // maps to copilot + materialsOpen
  }, [setRoute])

  return (
    <div className="mx-auto max-w-3xl">
      <MaterialsPanel embedded={false} />
    </div>
  )
}
