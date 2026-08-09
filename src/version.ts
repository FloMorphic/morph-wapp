// The app version shown in the header and settings. Injected at build time via
// VITE_APP_VERSION (the getting-started image passes the Makefile's VERSION);
// falls back to a dev marker for `pnpm dev` and unversioned builds.
export const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'
