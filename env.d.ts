/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the  flomorphic-api backend. Empty = run standalone with local persistence. */
  readonly VITE_API_BASE_URL?: string
  /** App version shown in the UI, injected at build time. Empty = 'dev'. */
  readonly VITE_APP_VERSION?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
