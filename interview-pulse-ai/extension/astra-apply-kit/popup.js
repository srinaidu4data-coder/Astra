const STORAGE_KEY = 'astra_form_pack_v1'
const statusEl = document.getElementById('status')
const metaEl = document.getElementById('meta')
const injectsEl = document.getElementById('injects')
const strictSoftEl = document.getElementById('strictSoft')
const strictSoftHintEl = document.getElementById('strictSoftHint')

function setStatus(msg, err = false) {
  statusEl.textContent = msg || ''
  statusEl.className = err ? 'err' : ''
}

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Product default true — match lab one_click / content.js selectPack. */
function isStrictSoft(store) {
  if (!store || typeof store !== 'object') return true
  return store.strict_soft !== false
}

/**
 * Stamp strict_soft on a store object (mutate + return).
 * Missing flag → true so older exports still get safe soft-skip policy.
 */
function withStrictSoft(store, strict) {
  if (!store || typeof store !== 'object') return store
  store.strict_soft = Boolean(strict)
  return store
}

function syncStrictSoftUi(store) {
  if (!strictSoftEl) return
  const on = isStrictSoft(store)
  strictSoftEl.checked = on
  strictSoftEl.disabled = !store
  if (strictSoftHintEl) {
    strictSoftHintEl.textContent = !store
      ? 'Load a kit first'
      : on
        ? 'Id / base only — soft sibling packs skipped on Fill'
        : 'Soft same-board packs may fill (sibling risk)'
  }
}

/** Mirror lab formPackInjectRows — active pack first, Tailor RT inject chips */
function formPackInjectRows(store, limit = 6) {
  if (!store?.job_packs?.length) return []
  const activeId = store.active_job_id ? String(store.active_job_id) : ''
  const rows = []
  for (const pack of store.job_packs) {
    if (!pack || pack.ok === false) continue
    const injects = (pack.forge?.injects || pack.tailor_rt?.injects || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean)
      .slice(0, 8)
    const grade =
      pack.forge?.grade ||
      pack.tailor_rt?.grade ||
      (pack.forge?.tailor_rt_passed === true ? 'pass' : null)
    const rt =
      typeof pack.forge?.tailor_rt_passed === 'boolean'
        ? pack.forge.tailor_rt_passed
        : typeof pack.tailor_rt?.passed === 'boolean'
          ? pack.tailor_rt.passed
          : null
    const jobId = String(pack.job_id || pack.job?.id || '')
    rows.push({
      jobId,
      title: pack.job?.title || jobId || 'Job pack',
      company: pack.job?.company || '',
      injects,
      grade: grade ? String(grade) : null,
      rtPassed: rt,
      active: Boolean(activeId && jobId && activeId === jobId),
    })
  }
  rows.sort((a, b) => Number(b.active) - Number(a.active))
  return rows.slice(0, limit)
}

function renderInjects(store) {
  if (!injectsEl) return
  if (!store) {
    injectsEl.innerHTML = ''
    return
  }
  const rows = formPackInjectRows(store, 6)
  if (!rows.length) {
    injectsEl.innerHTML = '<div class="muted">No job packs yet — export Apply Kit from Jobs lab.</div>'
    return
  }
  const total = rows.reduce((n, r) => n + r.injects.length, 0)
  injectsEl.innerHTML =
    `<div class="muted" style="margin-bottom:6px">${rows.length} pack(s) · ${total} keyword inject(s)</div>` +
    rows
      .map((row) => {
        const chips = []
        if (row.active) chips.push('<span class="chip active">active</span>')
        if (row.grade) chips.push(`<span class="chip grade">${esc(row.grade)}</span>`)
        if (row.rtPassed === true) chips.push('<span class="chip">RT ok</span>')
        if (row.rtPassed === false) chips.push('<span class="chip">RT gaps</span>')
        const title = esc(row.title) + (row.company ? ` · ${esc(row.company)}` : '')
        const kws =
          row.injects.length > 0
            ? row.injects.map((k) => `<span class="kw">${esc(k)}</span>`).join('')
            : '<span class="muted">No new injects (profile covered JD)</span>'
        return `<div class="pack-row"><div class="pack-title">${chips.join(' ')} ${title}</div><div>${kws}</div></div>`
      })
      .join('')
}

function renderMeta(store) {
  if (!store) {
    metaEl.innerHTML = '<span class="chip">empty</span> Sync from lab first'
    renderInjects(null)
    syncStrictSoftUi(null)
    return
  }
  const base = store.base || store
  const n = (store.job_packs || []).length
  const name = base.profile_snapshot?.name || base.fields?.full_name || 'pack'
  const email = base.profile_snapshot?.email || base.fields?.email || ''
  const injectN = formPackInjectRows(store, 99).reduce((a, r) => a + r.injects.length, 0)
  const strict = isStrictSoft(store)
  const modeChip = strict
    ? '<span class="chip">strict soft</span>'
    : '<span class="chip warn">soft allowed</span>'
  metaEl.innerHTML = `${modeChip}<span class="chip">loaded</span> ${esc(name)} · ${esc(email) || 'no email'} · ${n} job pack(s)${
    injectN ? ` · ${injectN} injects` : ''
  }`
  renderInjects(store)
  syncStrictSoftUi(store)
}

async function loadMeta() {
  const data = await chrome.storage.local.get([STORAGE_KEY])
  let store = data[STORAGE_KEY]
  // Migrate older kits: stamp default strict_soft so content.js policy is explicit
  if (store && typeof store === 'object' && store.strict_soft === undefined) {
    store = withStrictSoft(store, true)
    await chrome.storage.local.set({ [STORAGE_KEY]: store })
  }
  renderMeta(store)
}

if (strictSoftEl) {
  strictSoftEl.addEventListener('change', async () => {
    try {
      const data = await chrome.storage.local.get([STORAGE_KEY])
      let store = data[STORAGE_KEY]
      if (!store || typeof store !== 'object') {
        setStatus('Load a kit first, then set strict soft', true)
        strictSoftEl.checked = true
        return
      }
      store = withStrictSoft(store, strictSoftEl.checked)
      await chrome.storage.local.set({ [STORAGE_KEY]: store })
      renderMeta(store)
      setStatus(
        store.strict_soft
          ? 'Strict soft on — soft sibling packs skipped on Fill'
          : 'Strict soft off — soft same-board packs may fill',
      )
    } catch (e) {
      setStatus(String(e.message || e), true)
    }
  })
}

document.getElementById('btnImport').addEventListener('click', async () => {
  try {
    const raw = document.getElementById('paste').value.trim()
    if (!raw) {
      setStatus('Paste JSON first', true)
      return
    }
    let store = JSON.parse(raw)
    // Honor export flag; default true when older JSON omits it
    if (store && typeof store === 'object' && store.strict_soft === undefined) {
      store = withStrictSoft(store, true)
    }
    await chrome.storage.local.set({ [STORAGE_KEY]: store })
    renderMeta(store)
    setStatus(
      isStrictSoft(store)
        ? 'Imported form pack · strict soft on'
        : 'Imported form pack · soft packs allowed',
    )
  } catch (e) {
    setStatus(String(e.message || e), true)
  }
})

document.getElementById('btnClear').addEventListener('click', async () => {
  await chrome.storage.local.remove([STORAGE_KEY])
  renderMeta(null)
  setStatus('Cleared')
})

document.getElementById('btnFill').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) {
    setStatus('No active tab', true)
    return
  }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_PAGE' })
    if (res?.ok) {
      // Prefer content-script status (pack title + inject count); fall back for old builds
      const softBit = res.soft_skipped ? ' · soft skipped' : ''
      setStatus(
        (res.status ||
          `Filled ${res.filled} fields · ${res.job || 'pack'}` +
            (res.inject_count ? ` · ${res.inject_count} injects` : '')) + softBit,
      )
    } else setStatus(res?.error || 'Fill failed — reload page and retry', true)
  } catch (e) {
    setStatus('Content script not ready — reload the apply page', true)
  }
})

document.getElementById('btnSync').addEventListener('click', async () => {
  const base = (document.getElementById('apiBase').value || '').replace(/\/$/, '')
  setStatus('Syncing…')
  try {
    // Prefer store already exported by the Jobs UI into localStorage on 5173
    // Fall back to building from a minimal profile via form-pack base.
    // Lab UI writes window key via postMessage bridge when open.
    let store = null
    try {
      const r = await fetch(`${base}/api/jobsearch/apply/extension-store`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile: {
            name: 'Candidate',
            email: 'candidate@example.com',
            target_title: 'Software Engineer',
            skills: ['python', 'react', 'typescript'],
            summary: 'Software engineer',
            resume_text:
              'Software engineer with Python, React, TypeScript. Builds APIs and UIs.',
            phone: '5551234567',
            has_resume: true,
          },
          jobs: [],
          forge_top: 0,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      store = await r.json()
    } catch (e) {
      // Try reading last export from page localStorage via scripting if lab is open
      throw e
    }
    // Keep user's current toggle if a kit already existed; else API default (true)
    const prev = (await chrome.storage.local.get([STORAGE_KEY]))[STORAGE_KEY]
    const preferStrict =
      prev && typeof prev === 'object' && prev.strict_soft !== undefined
        ? isStrictSoft(prev)
        : store && store.strict_soft !== false
    store = withStrictSoft(store, preferStrict)
    await chrome.storage.local.set({ [STORAGE_KEY]: store })
    renderMeta(store)
    setStatus('Synced base pack from lab API — for job-specific packs use Export in Jobs UI')
  } catch (e) {
    setStatus(
      `Sync failed (${e.message}). Start API (START_JOBSEARCH_LAB.bat) or paste JSON from Jobs UI.`,
      true,
    )
  }
})

loadMeta()
