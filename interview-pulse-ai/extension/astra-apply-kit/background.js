/**
 * Astra Apply Kit — service worker.
 * Stores form packs from the lab API or popup paste.
 */
const STORAGE_KEY = 'astra_form_pack_v1'

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Astra Apply Kit] installed')
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_STORE') {
    chrome.storage.local.get([STORAGE_KEY], (data) => {
      sendResponse({ ok: true, store: data[STORAGE_KEY] || null })
    })
    return true
  }
  if (msg?.type === 'SET_STORE') {
    chrome.storage.local.set({ [STORAGE_KEY]: msg.store }, () => {
      sendResponse({ ok: true })
    })
    return true
  }
  if (msg?.type === 'CLEAR_STORE') {
    chrome.storage.local.remove([STORAGE_KEY], () => sendResponse({ ok: true }))
    return true
  }
  return false
})
