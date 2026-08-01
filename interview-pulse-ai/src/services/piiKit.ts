/**
 * PII hygiene for Apply Kit / form packs in localStorage.
 * - Strip or truncate high-risk fields on write
 * - TTL: auto-expire packs after 7 days
 * - clearLabPii() for logout / settings
 */

import {
  FORM_PACK_STORAGE_KEY,
  parseStoredFormPack,
  type ExtensionStoreResult,
} from '@/services/jobsearch'

const KIT_META_KEY = 'astra_form_pack_meta_v1'
const KIT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export type KitMeta = {
  savedAt: number
  expiresAt: number
  stripped: boolean
}

/** Fields never persisted at full length in browser storage */
const STRIP_KEYS = new Set([
  'resume_text',
  'resume_file_text',
  'tailored_resume',
  'forged_resume',
])

function scrubValue(key: string, v: unknown): unknown {
  if (STRIP_KEYS.has(key) && typeof v === 'string') {
    if (v.length <= 120) return v
    return `${v.slice(0, 80)}…[truncated for PII hygiene]`
  }
  if (key === 'email' && typeof v === 'string' && v.includes('@')) {
    // keep email — needed for autofill; user chose to store kit
    return v
  }
  if (key === 'phone' && typeof v === 'string' && v.length > 4) {
    return v
  }
  return v
}

function scrubDeep(obj: unknown, depth = 0): unknown {
  if (depth > 8 || obj == null) return obj
  if (Array.isArray(obj)) return obj.map((x) => scrubDeep(x, depth + 1))
  if (typeof obj !== 'object') return obj
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (STRIP_KEYS.has(k) && typeof v === 'string') {
      out[k] = scrubValue(k, v)
    } else if (v && typeof v === 'object') {
      out[k] = scrubDeep(v, depth + 1)
    } else {
      out[k] = scrubValue(k, v)
    }
  }
  return out
}

export function scrubFormPackForStorage(
  store: ExtensionStoreResult | Record<string, unknown>,
): Record<string, unknown> {
  const scrubbed = scrubDeep(store) as Record<string, unknown>
  scrubbed.pii_hygiene = {
    version: 1,
    truncated_resume_fields: true,
    note: 'Full resume text not stored in localStorage — re-export kit for complete text.',
  }
  return scrubbed
}

export function saveFormPackSecure(
  store: ExtensionStoreResult | Record<string, unknown>,
): void {
  if (typeof localStorage === 'undefined') return
  const body = scrubFormPackForStorage(store)
  localStorage.setItem(FORM_PACK_STORAGE_KEY, JSON.stringify(body))
  const meta: KitMeta = {
    savedAt: Date.now(),
    expiresAt: Date.now() + KIT_TTL_MS,
    stripped: true,
  }
  localStorage.setItem(KIT_META_KEY, JSON.stringify(meta))
}

export function loadFormPackSecure(): Record<string, unknown> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const rawMeta = localStorage.getItem(KIT_META_KEY)
    if (rawMeta) {
      const meta = JSON.parse(rawMeta) as KitMeta
      if (meta.expiresAt && Date.now() > meta.expiresAt) {
        clearLabPii({ kitsOnly: true })
        return null
      }
    }
    return parseStoredFormPack(localStorage.getItem(FORM_PACK_STORAGE_KEY))
  } catch {
    return null
  }
}

/** Clear Apply Kit + optional tracker. Call on logout / Settings. */
export function clearLabPii(opts?: { kitsOnly?: boolean; includeTracker?: boolean }) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(FORM_PACK_STORAGE_KEY)
    localStorage.removeItem(KIT_META_KEY)
    if (!opts?.kitsOnly || opts?.includeTracker) {
      if (opts?.includeTracker !== false && !opts?.kitsOnly) {
        // only clear tracker when full clear
      }
    }
    if (opts?.includeTracker) {
      localStorage.removeItem('ip_jobsearch_tracker_v1')
    }
  } catch {
    /* ignore */
  }
}

export function clearAllJobsearchLocalData() {
  if (typeof localStorage === 'undefined') return
  const keys = [
    FORM_PACK_STORAGE_KEY,
    KIT_META_KEY,
    'ip_jobsearch_tracker_v1',
    'ip_jobsearch_prefs_v4',
    'ip_auto_apply_prefs_v2',
    'astra_strict_soft_v1',
    'ip_jobsearch_seed_from_night',
  ]
  for (const k of keys) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  }
}
