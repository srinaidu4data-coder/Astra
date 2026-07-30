import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  fetchAdminUsers,
  updateUserModels,
  type ModelOption,
} from '@/services/admin'
import type { AuthUser } from '@/services/auth'
import { useAppStore } from '@/stores/app-store'
import { Loader2, RefreshCw, Search, Shield, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

const DEFAULT_PRIMARY = 'gpt-4o'
const DEFAULT_FALLBACK = 'gpt-4o-mini'

function modelLabel(id: string | null | undefined, models: ModelOption[]): string {
  if (!id) return 'Default'
  return models.find((m) => m.id === id)?.label ?? id
}

export function AdminPage() {
  const me = useAppStore((s) => s.user)
  const setAuthFromUser = useAppStore((s) => s.setAuthFromUser)

  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState<AuthUser[]>([])
  const [models, setModels] = useState<ModelOption[]>([])
  const [defaultPrimary, setDefaultPrimary] = useState(DEFAULT_PRIMARY)
  const [defaultFallback, setDefaultFallback] = useState(DEFAULT_FALLBACK)
  const [total, setTotal] = useState(0)

  // Local draft edits keyed by user id
  const [drafts, setDrafts] = useState<
    Record<
      number,
      { answer_model: string; fallback_model: string; is_admin: boolean }
    >
  >({})

  const load = useCallback(async (search: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchAdminUsers({ q: search, limit: 200 })
      setUsers(data.users)
      setTotal(data.total)
      setModels(data.models)
      setDefaultPrimary(data.default_answer_model || DEFAULT_PRIMARY)
      setDefaultFallback(data.default_fallback_model || DEFAULT_FALLBACK)
      const next: typeof drafts = {}
      for (const u of data.users) {
        next[u.id] = {
          answer_model: u.answer_model || '',
          fallback_model: u.fallback_model || '',
          is_admin: Boolean(u.is_admin),
        }
      }
      setDrafts(next)
    } catch (e) {
      setError((e as Error).message || 'Failed to load admin data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(query)
  }, [load, query])

  const primaryOptions = useMemo(() => {
    return [
      { id: '', label: `Default (${defaultPrimary})` },
      ...models.map((m) => ({ id: m.id, label: m.label })),
    ]
  }, [models, defaultPrimary])

  const fallbackOptions = useMemo(() => {
    return [
      { id: '', label: `Default (${defaultFallback})` },
      ...models.map((m) => ({ id: m.id, label: m.label })),
    ]
  }, [models, defaultFallback])

  const saveUser = async (userId: number) => {
    const d = drafts[userId]
    if (!d) return
    setSavingId(userId)
    setError(null)
    setMsg(null)
    try {
      const res = await updateUserModels(userId, {
        answer_model: d.answer_model || null,
        fallback_model: d.fallback_model || null,
        is_admin: d.is_admin,
      })
      setUsers((prev) => prev.map((u) => (u.id === userId ? res.user : u)))
      setDrafts((prev) => ({
        ...prev,
        [userId]: {
          answer_model: res.user.answer_model || '',
          fallback_model: res.user.fallback_model || '',
          is_admin: Boolean(res.user.is_admin),
        },
      }))
      // If we edited ourselves, refresh store so live sessions pick up new models
      if (me?.id === userId) {
        setAuthFromUser(res.user)
      }
      setMsg(`Saved models for ${res.user.email}`)
    } catch (e) {
      setError((e as Error).message || 'Save failed')
    } finally {
      setSavingId(null)
    }
  }

  const dirty = (u: AuthUser) => {
    const d = drafts[u.id]
    if (!d) return false
    return (
      (d.answer_model || '') !== (u.answer_model || '') ||
      (d.fallback_model || '') !== (u.fallback_model || '') ||
      d.is_admin !== Boolean(u.is_admin)
    )
  }

  if (!me?.is_admin) {
    return (
      <div className="mx-auto max-w-lg glass rounded-[28px] p-10 text-center">
        <Shield className="mx-auto mb-4 h-8 w-8 text-white/30" />
        <h2 className="text-[17px] font-medium text-white/90">Admin only</h2>
        <p className="mt-2 text-[13px] text-white/40">
          Your account is not an admin. Ask an existing admin to grant access, or
          set <code className="text-[#5DD5E3]">ADMIN_EMAILS</code> on the API.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <section className="glass rounded-[28px] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#5DD5E3]" strokeWidth={1.75} />
              <h2 className="text-[17px] font-medium tracking-tight text-white/95">
                Model console
              </h2>
            </div>
            <p className="max-w-xl text-[13px] leading-relaxed text-white/40">
              Assign a primary and fallback LLM per user. Global defaults are{' '}
              <span className="text-white/70">{defaultPrimary}</span> with fallback{' '}
              <span className="text-white/70">{defaultFallback}</span>. Empty =
              use default.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={() => void load(query)}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {models.map((m) => (
            <Badge
              key={m.id}
              tone={m.is_default ? 'emerald' : m.is_fallback_default ? 'amber' : 'default'}
            >
              {m.id}
              {m.is_default ? ' · default' : ''}
              {m.is_fallback_default ? ' · fallback' : ''}
            </Badge>
          ))}
        </div>

        <form
          className="mt-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault()
            setQuery(q.trim())
          }}
        >
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/30" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by email or name…"
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.04] pl-10 pr-3 text-[13px] text-white/90 outline-none placeholder:text-white/30 focus:border-[#20B8CD]/40"
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>

        {error && (
          <div className="mt-4 rounded-[14px] border border-[#E85D5D]/40 bg-[#E85D5D]/10 px-4 py-3 text-[13px] text-[#E85D5D]">
            {error}
          </div>
        )}
        {msg && (
          <div className="mt-4 rounded-[14px] border border-[#20B8CD]/30 bg-[#20B8CD]/10 px-4 py-3 text-[13px] text-[#5DD5E3]">
            {msg}
          </div>
        )}
      </section>

      <section className="glass overflow-hidden rounded-[28px]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-4">
          <h3 className="text-[14px] font-medium text-white/80">
            Users
            <span className="ml-2 text-white/35">({total})</span>
          </h3>
        </div>

        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-white/40">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-white/40">
            No users found.
          </div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {users.map((u) => {
              const d = drafts[u.id] ?? {
                answer_model: '',
                fallback_model: '',
                is_admin: false,
              }
              const isDirty = dirty(u)
              const effectivePrimary =
                d.answer_model || u.effective_answer_model || defaultPrimary
              const effectiveFallback =
                d.fallback_model || u.effective_fallback_model || defaultFallback

              return (
                <div
                  key={u.id}
                  className="flex flex-col gap-4 px-5 py-5 md:px-6 lg:flex-row lg:items-end lg:gap-5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-[14px] font-medium text-white/90">
                        {u.name || u.email}
                      </div>
                      {u.is_admin && <Badge tone="indigo">admin</Badge>}
                      <Badge tone={u.subscription_active ? 'emerald' : 'default'}>
                        {u.subscription_active ? 'subscribed' : u.subscription_status}
                      </Badge>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-white/40">
                      {u.email}
                      <span className="mx-1.5 text-white/20">·</span>
                      id {u.id}
                    </div>
                    <div className="mt-1.5 text-[11px] text-white/30">
                      Effective:{' '}
                      <span className="text-white/50">{effectivePrimary}</span>
                      {' → '}
                      <span className="text-white/50">{effectiveFallback}</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                        Primary
                      </span>
                      <select
                        value={d.answer_model}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [u.id]: { ...d, answer_model: e.target.value },
                          }))
                        }
                        className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
                      >
                        {primaryOptions.map((o) => (
                          <option key={o.id || 'default-p'} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                        Fallback
                      </span>
                      <select
                        value={d.fallback_model}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [u.id]: { ...d, fallback_model: e.target.value },
                          }))
                        }
                        className="h-10 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/90 outline-none focus:border-[#20B8CD]/40"
                      >
                        {fallbackOptions.map((o) => (
                          <option key={o.id || 'default-f'} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wide text-white/35">
                        Role
                      </span>
                      <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-xl border border-white/[0.08] bg-[#141414] px-3 text-[13px] text-white/80">
                        <input
                          type="checkbox"
                          checked={d.is_admin}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...d, is_admin: e.target.checked },
                            }))
                          }
                          className="h-4 w-4 accent-[#20B8CD]"
                        />
                        Admin access
                      </label>
                    </label>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      disabled={!isDirty || savingId === u.id}
                      onClick={() => void saveUser(u.id)}
                    >
                      {savingId === u.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      {isDirty ? 'Save' : 'Saved'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <p className="px-1 text-[12px] text-white/30">
        Tip: bootstrap the first admin with Railway env{' '}
        <code className="text-white/45">ADMIN_EMAILS=you@example.com</code>, then
        sign in. Assigned models apply to live interview and typed answers.
        Currently assigned primary for you:{' '}
        <span className="text-white/50">
          {modelLabel(me.answer_model, models) === 'Default'
            ? defaultPrimary
            : modelLabel(me.answer_model, models)}
        </span>
        .
      </p>
    </div>
  )
}
