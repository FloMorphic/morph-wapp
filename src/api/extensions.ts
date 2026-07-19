import type { EnvVar, ExtensionStatus, ProjectExtension } from '@/types/api'
import { apiEnabled, http } from './client'
import { readCollection, writeCollection } from '@/lib/localStore'
import { createId, now } from '@/lib/id'

/**
 * Project-extension repository.
 *
 * A project extension is a source repo the backend clones and runs (with the
 * supplied env) so it joins the inflow ecosystem and exposes plugin nodes. The
 * heavy lifting — clone, install, run — happens server-side; the frontend
 * registers the intent and tracks status.
 *
 * When a backend is configured these calls target `/extension/project`
 * (proposed); otherwise registrations are kept in localStorage so the manager
 * is fully usable offline.
 */

const LOCAL_KEY = 'extensions'

export interface AddExtensionInput {
  name: string
  repo: string
  ref?: string
  description?: string
  env?: EnvVar[]
}

function localAll(): ProjectExtension[] {
  return readCollection<ProjectExtension>(LOCAL_KEY).sort((a, b) => b.updatedAt - a.updatedAt)
}

export const extensionsApi = {
  isRemote: apiEnabled,

  list(): Promise<ProjectExtension[]> {
    if (apiEnabled()) return http.get<ProjectExtension[]>('/extension/project')
    return Promise.resolve(localAll())
  },

  add(input: AddExtensionInput): Promise<ProjectExtension> {
    if (apiEnabled()) return http.post<ProjectExtension>('/extension/project', input)
    const ts = now()
    const record: ProjectExtension = {
      id: createId('ext'),
      name: input.name,
      repo: input.repo,
      ref: input.ref || 'main',
      description: input.description ?? '',
      env: input.env ?? [],
      status: 'registered',
      createdAt: ts,
      updatedAt: ts,
    }
    const all = readCollection<ProjectExtension>(LOCAL_KEY)
    all.push(record)
    writeCollection(LOCAL_KEY, all)
    return Promise.resolve(record)
  },

  setStatus(id: string, status: ExtensionStatus): Promise<void> {
    if (apiEnabled()) return http.post<void>(`/extension/project/${id}/status`, { status })
    const all = readCollection<ProjectExtension>(LOCAL_KEY)
    const idx = all.findIndex((e) => e.id === id)
    if (idx >= 0) {
      all[idx] = { ...all[idx], status, updatedAt: now() }
      writeCollection(LOCAL_KEY, all)
    }
    return Promise.resolve()
  },

  remove(id: string): Promise<void> {
    if (apiEnabled()) return http.delete<void>(`/extension/project/${id}`)
    writeCollection(
      LOCAL_KEY,
      readCollection<ProjectExtension>(LOCAL_KEY).filter((e) => e.id !== id),
    )
    return Promise.resolve()
  },
}
