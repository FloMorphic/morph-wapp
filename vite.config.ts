import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    /**
     * One Vue, always.
     *
     * The `@inflowenger/*` packages take Vue as a peer dependency, which is
     * right — but while they are consumed through a local `link:` (rather than
     * from the registry) each of them brings its own copy along for its own
     * builds and tests. Two Vue runtimes in one page is not a version-skew
     * nuisance, it is a broken application: reactivity effects registered by
     * one are invisible to the other, `provide`/`inject` stops crossing the
     * boundary, and a renderer handed to `<JsonForms>` is proxied by the wrong
     * instance. Deduping makes the resolver pick this app's copy for everyone.
     */
    dedupe: ['vue'],
  },
  // Relative base so the built SPA can be served from any sub-path,
  // a file:// path, or an Electron shell — FloMorphic runs local or online.
  base: './',
})
