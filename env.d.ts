/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Inflowenger inspector-api backend. Empty = run standalone with local persistence. */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
