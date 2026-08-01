/**
 * Astra Apply Kit — content script.
 * Autofills visible form fields from the stored pack (Simplify-style).
 * Does NOT auto-submit unless user clicks the extension "Fill page" + they submit.
 */
;(() => {
  const STORAGE_KEY = 'astra_form_pack_v1'
  const URL_SKIP = new Set([
    '',
    'www',
    'jobs',
    'job',
    'apply',
    'application',
    'applications',
    'careers',
    'career',
    'en',
    'us',
    'uk',
    'boards',
    'embed',
    'o',
    's',
    'j',
    'v1',
    'v2',
    'api',
    'view',
    'posting',
    'position',
    'positions',
    'opening',
    'openings',
    'gh_jid',
  ])
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  /** Mirror jobsearch.form_pack._parse_apply_url / score_url_match (keep in sync). */
  function parseApplyUrl(url) {
    const empty = { host: '', path: '', tokens: [], ids: new Set() }
    let raw = String(url || '').trim()
    if (!raw) return empty
    if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw
    let u
    try {
      u = new URL(raw)
    } catch {
      return empty
    }
    let host = (u.hostname || '').toLowerCase()
    if (host.startsWith('www.')) host = host.slice(4)
    const path = (u.pathname || '').toLowerCase().replace(/\/$/, '')
    const tokens = []
    const ids = new Set()
    for (let seg of path.split('/')) {
      let s = (seg || '').trim().toLowerCase()
      if (!s || URL_SKIP.has(s)) continue
      if (s.endsWith('.html')) s = s.slice(0, -5)
      tokens.push(s)
      if (/^\d{4,}$/.test(s)) ids.add(s)
      else if (UUID_RE.test(s)) ids.add(s)
      else if (s.length >= 8 && /^[a-z0-9_-]+$/.test(s) && /\d/.test(s)) ids.add(s)
    }
    try {
      for (const [k, vals] of u.searchParams.entries()) {
        const lk = String(k).toLowerCase()
        if (
          !['gh_jid', 'jobid', 'job_id', 'job', 'id', 'posting_id'].includes(lk) &&
          !lk.includes('jid') &&
          !lk.includes('job')
        ) {
          continue
        }
        const vv = String(vals || '')
          .trim()
          .toLowerCase()
        if (vv) {
          ids.add(vv)
          tokens.push(vv)
        }
      }
    } catch {
      /* ignore */
    }
    return { host, path, tokens, ids }
  }

  function scoreUrlMatch(pageUrl, packUrl) {
    const page = parseApplyUrl(pageUrl)
    const pack = parseApplyUrl(packUrl)
    if (!page.host || !pack.host) return 0
    let score = 0
    const ph = page.host
    const ah = pack.host
    if (ph === ah) score += 40
    else if (ph.endsWith('.' + ah) || ah.endsWith('.' + ph)) score += 30
    else {
      const pParts = ph.split('.')
      const aParts = ah.split('.')
      if (
        pParts.length >= 2 &&
        aParts.length >= 2 &&
        pParts.slice(-2).join('.') === aParts.slice(-2).join('.')
      ) {
        score += 15
      } else {
        return 0
      }
    }
    if (page.path && page.path === pack.path) {
      score += 60
    } else {
      const pTok = new Set(page.tokens)
      const aTok = new Set(pack.tokens)
      const sharedIds = [...page.ids].filter((x) => pack.ids.has(x))
      if (sharedIds.length) score += 55
      let soft = 0
      for (const t of pTok) {
        if (aTok.has(t) && !page.ids.has(t)) soft++
      }
      if (soft) score += Math.min(30, 10 * soft)
      if (pack.tokens.length) {
        const last = pack.tokens[pack.tokens.length - 1]
        if (page.path.includes(last)) {
          score += pack.ids.has(last) || /^\d+$/.test(last) ? 20 : 10
        }
      }
    }
    return score
  }

  /** Mirror form_pack.has_url_id_token_match — true id/path, not same-board slug only. */
  function hasUrlIdTokenMatch(pageUrl, packUrl, jobId) {
    const page = parseApplyUrl(pageUrl)
    const pack = parseApplyUrl(packUrl)
    for (const id of page.ids) {
      if (pack.ids.has(id)) return true
    }
    if (page.path && pack.path && page.path === pack.path) return true
    const rawPage = String(pageUrl || '').toLowerCase()
    const jid = String(jobId || '').trim()
    if (jid && jid !== 'base-profile' && jid.toLowerCase() && rawPage.includes(jid.toLowerCase())) {
      return true
    }
    if (pack.tokens.length) {
      const last = pack.tokens[pack.tokens.length - 1]
      if (
        (pack.ids.has(last) || (/^\d+$/.test(last) && last.length >= 4)) &&
        (page.path || '').includes(last)
      ) {
        return true
      }
    }
    return false
  }

  function packApplyUrl(p) {
    const job = (p && p.job) || {}
    return String(job.apply_url || job.url || (p && p.apply_url) || '').trim()
  }

  function packJobId(p) {
    const job = (p && p.job) || {}
    return String((p && p.job_id) || job.id || '').trim()
  }

  /**
   * Prefer pack whose apply_url matches the current page (Greenhouse/Lever/etc.).
   * Id-token / score>=70 wins over same-board soft. When store.strict_soft !== false
   * (product default), soft URL hits do not fill sibling pack materials — use base
   * contact fields only (soft_skipped). Falls back to active_job_id → first → base.
   * Returns { pack, reason, score, match_kind?, soft_skipped?, id_token? }.
   */
  function selectPack(store, pageUrl) {
    if (!store) return { pack: null, reason: 'none', score: 0 }
    const packs = (store.job_packs || []).filter((p) => p && p.ok !== false)
    // Default true: cold/base before soft sibling mis-fill (align lab one_click)
    const strictSoft = store.strict_soft !== false
    const page = String(pageUrl || '').trim()
    let bestId = null
    let bestIdScore = 0
    let bestSoft = null
    let bestSoftScore = 0
    if (page && packs.length) {
      for (const p of packs) {
        const packUrl = packApplyUrl(p)
        const jid = packJobId(p)
        let sc = scoreUrlMatch(page, packUrl)
        if (jid && jid !== 'base-profile' && page.toLowerCase().includes(jid.toLowerCase())) {
          sc = Math.max(sc, 70)
        }
        if (sc < 50) continue
        const idHit = hasUrlIdTokenMatch(page, packUrl, jid) || sc >= 70
        if (idHit) {
          if (sc > bestIdScore) {
            bestIdScore = sc
            bestId = p
          }
        } else if (sc > bestSoftScore) {
          bestSoftScore = sc
          bestSoft = p
        }
      }
      if (bestId) {
        return {
          pack: bestId,
          reason: 'url',
          score: bestIdScore,
          match_kind: 'id',
          id_token: true,
        }
      }
      if (bestSoft) {
        if (strictSoft) {
          // Soft same-board only — do not overlay sibling tailored resume/cover
          const base =
            store.base && store.base.fields
              ? store.base
              : store.fields
                ? store
                : null
          return {
            pack: base,
            reason: 'strict_soft_skip',
            score: bestSoftScore,
            match_kind: 'soft',
            soft_skipped: true,
            id_token: false,
          }
        }
        // Prefer active among soft hits when non-strict
        const activeId = String(store.active_job_id || '').trim()
        if (activeId) {
          const softActive = packs.find((p) => packJobId(p) === activeId)
          if (softActive) {
            const sc = scoreUrlMatch(page, packApplyUrl(softActive))
            if (sc >= 50) {
              return {
                pack: softActive,
                reason: 'url',
                score: Math.max(sc, bestSoftScore),
                match_kind: 'soft',
                id_token: false,
              }
            }
          }
        }
        return {
          pack: bestSoft,
          reason: 'url',
          score: bestSoftScore,
          match_kind: 'soft',
          id_token: false,
        }
      }
    }
    const id = store.active_job_id
    if (id && packs.length) {
      const hit = packs.find((p) => p && String(p.job_id) === String(id))
      if (hit) return { pack: hit, reason: 'active_id', score: bestIdScore || bestSoftScore }
    }
    if (packs.length) return { pack: packs[0], reason: 'first', score: bestIdScore || bestSoftScore }
    if (store.base) return { pack: store.base, reason: 'base', score: 0 }
    if (store.fields) return { pack: store, reason: 'base', score: 0 }
    return { pack: null, reason: 'none', score: 0 }
  }

  function activePack(store, pageUrl) {
    return selectPack(store, pageUrl || (typeof location !== 'undefined' ? location.href : '')).pack
  }

  function activePackSelection(store, pageUrl) {
    return selectPack(store, pageUrl || (typeof location !== 'undefined' ? location.href : ''))
  }

  /** Tailor RT / forge keyword injects for the active pack (display + FILL_PAGE payload). */
  function packInjects(pack) {
    if (!pack) return []
    const raw = (pack.forge && pack.forge.injects) || (pack.tailor_rt && pack.tailor_rt.injects) || []
    const out = []
    const seen = new Set()
    for (const k of raw) {
      const t = String(k || '').trim()
      if (!t) continue
      const key = t.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(t)
      if (out.length >= 8) break
    }
    return out
  }

  function packMeta(pack) {
    const title = (pack && pack.job && pack.job.title) || ''
    const company = (pack && pack.job && pack.job.company) || ''
    const injects = packInjects(pack)
    const grade =
      (pack && pack.forge && pack.forge.grade) ||
      (pack && pack.tailor_rt && pack.tailor_rt.grade) ||
      ''
    const label =
      title ||
      (pack && pack.profile_snapshot && pack.profile_snapshot.name) ||
      (pack && pack.fields && pack.fields.full_name) ||
      'base pack'
    return { title, company, injects, grade, label }
  }

  function packStatusLine(pack, prefix) {
    const m = packMeta(pack)
    const parts = []
    if (prefix) parts.push(prefix)
    parts.push(m.label)
    if (m.company) parts.push(m.company)
    if (m.grade) parts.push(String(m.grade))
    if (m.injects.length) parts.push(`${m.injects.length} inject${m.injects.length === 1 ? '' : 's'}`)
    else if (m.title) parts.push('no new injects')
    return parts.filter(Boolean).join(' · ')
  }

  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim()
  }

  function scoreLabel(label, key) {
    const L = norm(label)
    const K = norm(key)
    if (!L || !K) return 0
    if (L === K) return 100
    if (L.includes(K) || K.includes(L)) return 80
    const parts = K.split(/[\s/_-]+/).filter(Boolean)
    let hits = 0
    for (const p of parts) if (L.includes(p)) hits++
    return hits ? (hits / parts.length) * 60 : 0
  }

  function bestValue(labelMap, fields, el) {
    const bits = [
      el.getAttribute('name'),
      el.getAttribute('id'),
      el.getAttribute('placeholder'),
      el.getAttribute('aria-label'),
      el.getAttribute('autocomplete'),
      el.type,
    ]
    // nearest label
    try {
      if (el.labels && el.labels[0]) bits.push(el.labels[0].innerText)
    } catch {
      /* ignore */
    }
    const label = bits.filter(Boolean).join(' ')
    let bestKey = ''
    let bestScore = 0
    const map = { ...(labelMap || {}) }
    // also score field keys
    for (const [k, v] of Object.entries(fields || {})) {
      if (v == null || v === '') continue
      map[k.replace(/_/g, ' ')] = String(v)
    }
    for (const [k, v] of Object.entries(map)) {
      if (!v) continue
      const sc = scoreLabel(label, k)
      if (sc > bestScore) {
        bestScore = sc
        bestKey = k
      }
    }
    // hard rules
    const L = norm(label)
    const f = fields || {}
    if (el.type === 'email' || L.includes('email')) return f.email || map.email || ''
    if (el.type === 'tel' || L.includes('phone') || L.includes('mobile'))
      return f.phone || map.phone || ''
    if (L.includes('first') && L.includes('name')) return f.first_name || ''
    if (L.includes('last') && L.includes('name')) return f.last_name || ''
    if (L === 'name' || L.includes('full name')) return f.full_name || ''
    if (bestScore >= 40) return map[bestKey] || ''
    return ''
  }

  function setNativeValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  async function fillDocument(doc, pack) {
    const fields = pack.fields || {}
    const labelMap = pack.label_map || {}
    let filled = 0
    const inputs = doc.querySelectorAll('input, textarea, select')
    for (const el of inputs) {
      try {
        if (el.disabled || el.readOnly) continue
        const typ = (el.type || 'text').toLowerCase()
        if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image'].includes(typ)) {
          // file: skip (browser security) — user attaches tailored resume manually
          continue
        }
        if (el.tagName === 'SELECT') continue
        const val = bestValue(labelMap, fields, el)
        if (!val) continue
        if (String(el.value || '').trim() === String(val).trim()) continue
        el.focus()
        setNativeValue(el, String(val))
        filled++
      } catch {
        /* ignore field */
      }
    }
    return filled
  }

  function matchPrefix(sel) {
    const reason = typeof sel === 'string' ? sel : sel && sel.reason
    if (reason === 'strict_soft_skip' || (sel && sel.soft_skipped)) {
      return 'Soft skipped · base only'
    }
    if (reason === 'url') {
      if (sel && sel.match_kind === 'soft') return 'URL soft match'
      return 'URL id match'
    }
    if (reason === 'active_id') return 'Active'
    if (reason === 'first') return 'First pack'
    if (reason === 'base') return 'Base pack'
    return 'Pack'
  }

  async function runFill() {
    const data = await chrome.storage.local.get([STORAGE_KEY])
    const store = data[STORAGE_KEY]
    const sel = activePackSelection(store)
    const pack = sel.pack
    if (!pack || !pack.fields) {
      if (sel && sel.soft_skipped) {
        return {
          ok: false,
          error:
            'Soft same-board kit match only — strict soft skipped sibling pack. Export kit for this job id, or turn off strict soft.',
          match_reason: sel.reason,
          soft_skipped: true,
        }
      }
      return { ok: false, error: 'No form pack. Open popup → Sync from lab.' }
    }
    let filled = await fillDocument(document, pack)
    // same-origin iframes we can access
    for (const frame of document.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument
        if (doc) filled += await fillDocument(doc, pack)
      } catch {
        /* cross-origin */
      }
    }
    const meta = packMeta(pack)
    const prefix = `Filled ${filled} fields · ${matchPrefix(sel)}`
    return {
      ok: true,
      filled,
      job: meta.title || meta.label,
      company: meta.company,
      grade: meta.grade || null,
      injects: meta.injects,
      inject_count: meta.injects.length,
      match_reason: sel.reason,
      match_score: sel.score,
      match_kind: sel.match_kind || null,
      soft_skipped: Boolean(sel.soft_skipped),
      status: packStatusLine(pack, prefix),
    }
  }

  // Floating mini control on job/apply pages
  function injectBar(initialStore) {
    if (document.getElementById('astra-apply-kit-bar')) return
    const bar = document.createElement('div')
    bar.id = 'astra-apply-kit-bar'
    const readySel = activePackSelection(initialStore)
    const readyPack = readySel.pack
    const readyLine = readyPack
      ? packStatusLine(readyPack, matchPrefix(readySel))
      : readySel && readySel.soft_skipped
        ? 'Soft kit skipped (strict) — base-only or re-export kit for this job'
        : 'Ready — import Apply Kit in popup'
    bar.innerHTML = `
      <style>
        #astra-apply-kit-bar {
          position: fixed; z-index: 2147483646; right: 16px; bottom: 16px;
          font: 12px/1.3 system-ui, sans-serif; color: #e8e8e8;
          background: #0e0e0e; border: 1px solid rgba(32,184,205,.45);
          border-radius: 12px; padding: 10px 12px; box-shadow: 0 8px 28px rgba(0,0,0,.45);
          display: flex; gap: 8px; align-items: flex-start; max-width: 320px;
        }
        #astra-apply-kit-bar button {
          cursor: pointer; border: 0; border-radius: 8px; padding: 6px 10px;
          background: #20B8CD; color: #0c0c0c; font-weight: 700; font-size: 12px;
          flex-shrink: 0;
        }
        #astra-apply-kit-bar button.ghost {
          background: transparent; color: #5DD5E3; border: 1px solid rgba(255,255,255,.12);
        }
        #astra-apply-kit-bar .msg { opacity: .8; font-size: 11px; word-break: break-word; }
        #astra-apply-kit-bar .kws { margin-top: 4px; display: flex; flex-wrap: wrap; gap: 4px; }
        #astra-apply-kit-bar .kw {
          font-size: 10px; padding: 1px 6px; border-radius: 6px;
          background: rgba(32,184,205,.15); color: #5DD5E3;
        }
        #astra-apply-kit-bar .actions { display: flex; flex-direction: column; gap: 6px; }
      </style>
      <div style="min-width:0;flex:1">
        <div style="font-weight:600;margin-bottom:4px">Astra Apply Kit</div>
        <div class="msg" id="astra-apply-kit-msg"></div>
        <div class="kws" id="astra-apply-kit-kws"></div>
      </div>
      <div class="actions">
        <button type="button" id="astra-apply-kit-fill">Fill form</button>
        <button type="button" class="ghost" id="astra-apply-kit-hide">Hide</button>
      </div>
    `
    document.documentElement.appendChild(bar)
    bar.querySelector('#astra-apply-kit-msg').textContent = readyLine

    function renderKwChips(injects) {
      const el = bar.querySelector('#astra-apply-kit-kws')
      if (!el) return
      el.replaceChildren()
      for (const k of (injects || []).slice(0, 6)) {
        const span = document.createElement('span')
        span.className = 'kw'
        span.textContent = k
        el.appendChild(span)
      }
    }
    if (readyPack) renderKwChips(packInjects(readyPack))

    bar.querySelector('#astra-apply-kit-fill').addEventListener('click', async () => {
      const msg = bar.querySelector('#astra-apply-kit-msg')
      msg.textContent = 'Filling…'
      const r = await runFill()
      if (r.ok) {
        msg.textContent = r.status || `Filled ${r.filled} fields · ${r.job || ''}`
        renderKwChips(r.injects)
      } else {
        msg.textContent = r.error || 'Failed'
      }
    })
    bar.querySelector('#astra-apply-kit-hide').addEventListener('click', () => bar.remove())
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'FILL_PAGE') {
      runFill().then(sendResponse)
      return true
    }
    return false
  })

  // Only show bar if we have a pack
  try {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      if (data[STORAGE_KEY]) {
        // delay so SPA pages mount
        setTimeout(() => injectBar(data[STORAGE_KEY]), 800)
      }
    })
  } catch {
    /* not in extension context */
  }
})()
