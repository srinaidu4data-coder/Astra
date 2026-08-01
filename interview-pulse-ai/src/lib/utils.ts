import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`
}

export function formatMs(ms: number) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function highlightMetrics(text: string): string[] {
  const matches = text.match(
    /\b\d+(\.\d+)?\s?(%|x|X|k|K|M|ms|s|QPS|users|latency|throughput)?\b/g,
  )
  return matches ?? []
}

/** Avatar / chip initials from a company or person name. */
export function companyInitials(company: string, fallback = 'J'): string {
  const parts = (company || fallback).trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() || '').join('') || fallback
}
