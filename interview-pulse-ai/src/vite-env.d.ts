/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COPILOT_API?: string
  readonly VITE_COPILOT_API_URL?: string
  readonly VITE_COPILOT_WS?: string
  /** Full URL to desktop installer (overrides /downloads/ default). */
  readonly VITE_DESKTOP_DOWNLOAD_URL?: string
  readonly VITE_DESKTOP_DOWNLOAD_URL_MAC?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
