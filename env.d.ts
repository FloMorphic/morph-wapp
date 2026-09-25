/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the  flomorphic-api backend. Empty = run standalone with local persistence. */
  readonly VITE_API_BASE_URL?: string
  /** App version shown in the UI, injected at build time. Empty = 'dev'. */
  readonly VITE_APP_VERSION?: string
  /** HS256 bearer for an API running with AUTH_ENABLED=true, signed with its
   *  API_JWT_SECRET. Empty = send no Authorization header. */
  readonly VITE_API_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
