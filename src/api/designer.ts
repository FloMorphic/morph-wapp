import type { VueFlowGraph } from '@/types/api'
import { apiEnabled, http } from './client'

/**
 * The AI workflow-designer prompt, built by the backend.
 *
 * The prompt that the build-ai dialog hands the user to run in an assistant is
 * assembled centrally by flomorphic-api (`designer` package / `POST
 * /designer/prompt`), so its node semantics and rules are authored in one place
 * and shared with the MCP tools. The imported-plugin section is resolved
 * server-side from the extension table, so the client only sends the goal and
 * the current canvas.
 *
 * Backend-only: with no backend configured the dialog falls back to the
 * client-side {@link buildDesignerPrompt} instead of calling this.
 */
export interface DesignerPromptInput {
  goal: string
  graph?: VueFlowGraph
}

export const designerApi = {
  isRemote: apiEnabled,

  buildPrompt(input: DesignerPromptInput): Promise<string> {
    return http.post<{ prompt: string }>('/designer/prompt', input).then((r) => r.prompt)
  },
}
