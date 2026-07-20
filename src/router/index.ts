import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'

/**
 * Hash history keeps the SPA portable — it runs from a static host, a sub-path,
 * a file:// path or an Electron shell with no server-side rewrite rules.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppLayout,
    redirect: '/workflows',
    children: [
      {
        path: 'workflows',
        name: 'workflows',
        component: () => import('@/views/WorkflowsView.vue'),
        meta: { title: 'Workflows', section: 'workflows' },
      },
      {
        path: 'workflows/new',
        name: 'workflow-new',
        component: () => import('@/views/WorkflowEditorView.vue'),
        meta: { title: 'New workflow', section: 'workflows', chromeless: true },
      },
      {
        path: 'workflows/:id',
        name: 'workflow-edit',
        component: () => import('@/views/WorkflowEditorView.vue'),
        props: true,
        meta: { title: 'Edit workflow', section: 'workflows', chromeless: true },
      },
      {
        path: 'extensions',
        name: 'extensions',
        component: () => import('@/views/ExtensionsView.vue'),
        meta: { title: 'Extensions', section: 'extensions' },
      },
      {
        path: 'memory',
        name: 'memory',
        component: () => import('@/views/MemoryView.vue'),
        meta: { title: 'Memory', section: 'memory' },
      },
      {
        path: 'contexts',
        name: 'contexts',
        component: () => import('@/views/ContextsView.vue'),
        meta: { title: 'Contexts', section: 'contexts' },
      },
      {
        path: 'prompts',
        name: 'prompts',
        component: () => import('@/views/PromptsView.vue'),
        meta: { title: 'Prompts', section: 'prompts' },
      },
      {
        path: 'human-tasks',
        name: 'human-tasks',
        component: () => import('@/views/HumanTasksView.vue'),
        meta: { title: 'Human Tasks', section: 'human-tasks' },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/views/SettingsView.vue'),
        meta: { title: 'Settings', section: 'settings' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.afterEach((to) => {
  const base = 'FloMorphic'
  document.title = to.meta.title ? `${to.meta.title} · ${base}` : base
})

export default router
