import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Base styles + design tokens (Tailwind v4)
import './style.css'

// Vue Flow core + add-on styles (canvas, controls, minimap)
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import '@vue-flow/minimap/dist/style.css'

// FloMorphic Vue Flow overrides (themed to design tokens)
import './assets/vue-flow.css'

createApp(App).use(createPinia()).use(router).mount('#app')
