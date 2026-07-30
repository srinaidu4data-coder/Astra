import { useEffect, useState } from 'react'

/** Tailwind `md` breakpoint — below this we use the phone shell. */
export const MOBILE_MAX_WIDTH = 767

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return (
    'ontouchstart' in window ||
    navigator.maxTouchPoints > 0 ||
    // @ts-expect-error legacy
    navigator.msMaxTouchPoints > 0
  )
}

/** True when the user is likely on a phone browser (viewport + touch). */
export function isPhoneExperience(): boolean {
  if (typeof window === 'undefined') return false
  // Electron desktop shell is never "phone UI"
  if (window.interviewPulse) return false
  return isMobileViewport()
}

/**
 * React hook: subscribe to viewport width for mobile shell.
 * Defaults to false (desktop layout) on SSR / first paint to avoid flash of wrong nav.
 */
export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`)
    const apply = () => setMobile(mq.matches && !window.interviewPulse)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  return mobile
}
