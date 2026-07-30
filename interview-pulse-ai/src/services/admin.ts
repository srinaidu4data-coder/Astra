/** Admin console API — model catalog + per-user assignment. */

import { authHeaders, type AuthUser } from '@/services/auth'
import { resolveCopilotHttpBase } from '@/lib/api-base'

const API_BASE = resolveCopilotHttpBase()

export type ModelOption = {
  id: string
  label: string
  is_default?: boolean
  is_fallback_default?: boolean
}

export type AdminUsersResponse = {
  users: AuthUser[]
  total: number
  default_answer_model: string
  default_fallback_model: string
  models: ModelOption[]
}

export type AdminModelsResponse = {
  models: ModelOption[]
  default_answer_model: string
  default_fallback_model: string
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json()
    if (typeof j?.detail === 'string') return j.detail
    if (j?.detail?.error?.message) return j.detail.error.message
    if (j?.error?.message) return j.error.message
    if (Array.isArray(j?.detail)) {
      return j.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ')
    }
    return res.statusText || `HTTP ${res.status}`
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function fetchAdminModels(): Promise<AdminModelsResponse> {
  const res = await fetch(`${API_BASE}/v1/admin/models`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchAdminUsers(opts?: {
  q?: string
  limit?: number
  offset?: number
}): Promise<AdminUsersResponse> {
  const sp = new URLSearchParams()
  if (opts?.q) sp.set('q', opts.q)
  if (opts?.limit != null) sp.set('limit', String(opts.limit))
  if (opts?.offset != null) sp.set('offset', String(opts.offset))
  const qs = sp.toString()
  const res = await fetch(`${API_BASE}/v1/admin/users${qs ? `?${qs}` : ''}`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function updateUserModels(
  userId: number,
  body: {
    answer_model?: string | null
    fallback_model?: string | null
    is_admin?: boolean
  },
): Promise<{ ok: boolean; user: AuthUser }> {
  const res = await fetch(`${API_BASE}/v1/admin/users/${userId}`, {
    method: 'PATCH',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}

export async function fetchAdminMe(): Promise<{
  ok: boolean
  user: AuthUser
  models: ModelOption[]
  default_answer_model: string
  default_fallback_model: string
}> {
  const res = await fetch(`${API_BASE}/v1/admin/me`, {
    headers: { ...authHeaders() },
  })
  if (!res.ok) throw new Error(await parseError(res))
  return res.json()
}
