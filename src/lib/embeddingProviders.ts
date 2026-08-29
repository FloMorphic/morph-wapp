/**
 * Embedding-provider catalog for the add-vector-store form.
 *
 * A vector store captures a provider + embedding model + output dimension once,
 * and the backend reuses them for every index and search. The provider isn't a
 * free-text guess: every entry here is a provider the backend can actually reach
 * (all through one OpenAI-compatible embeddings path — see the Go `svc` package's
 * embed.go), and each carries the common models with their *default* output
 * dimension so the form can pre-fill the size field.
 *
 * The model list is only a starting point — the form also loads the live model
 * list from the provider's API (via the backend proxy, so the key stays server
 * side). Dimensions stay an editable number because several models
 * (text-embedding-3-*, gemini-embedding-001, embed-v4.0…) support more than one
 * output size; the catalog value is just the sensible default.
 */

export interface EmbeddingModelSpec {
  id: string
  /** Default output dimension for this model. */
  dimensions: number
}

export interface EmbeddingProviderSpec {
  value: string
  label: string
  /** Common models with default dimensions; the form can also fetch the live list. */
  models: EmbeddingModelSpec[]
  /** True for the OpenAI-compatible escape hatch, where the user supplies a base URL. */
  custom?: boolean
  /** Whether the provider exposes a list-models API the form can call. */
  listable?: boolean
}

export const embeddingProviders: EmbeddingProviderSpec[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    listable: true,
    models: [
      { id: 'text-embedding-3-small', dimensions: 1536 },
      { id: 'text-embedding-3-large', dimensions: 3072 },
      { id: 'text-embedding-ada-002', dimensions: 1536 },
    ],
  },
  {
    value: 'gemini',
    label: 'Google Gemini',
    listable: true,
    models: [
      { id: 'gemini-embedding-001', dimensions: 3072 },
      { id: 'text-embedding-004', dimensions: 768 },
      { id: 'embedding-001', dimensions: 768 },
    ],
  },
  {
    value: 'cohere',
    label: 'Cohere',
    listable: true,
    models: [
      { id: 'embed-v4.0', dimensions: 1536 },
      { id: 'embed-english-v3.0', dimensions: 1024 },
      { id: 'embed-multilingual-v3.0', dimensions: 1024 },
      { id: 'embed-english-light-v3.0', dimensions: 384 },
      { id: 'embed-multilingual-light-v3.0', dimensions: 384 },
    ],
  },
  {
    value: 'mistral',
    label: 'Mistral',
    listable: true,
    models: [{ id: 'mistral-embed', dimensions: 1024 }],
  },
  {
    value: 'voyage',
    label: 'Voyage AI',
    listable: true,
    models: [
      { id: 'voyage-3-large', dimensions: 1024 },
      { id: 'voyage-3', dimensions: 1024 },
      { id: 'voyage-3-lite', dimensions: 512 },
      { id: 'voyage-code-3', dimensions: 1024 },
    ],
  },
  {
    value: 'custom',
    label: 'OpenAI-compatible (custom URL)',
    custom: true,
    listable: true,
    models: [],
  },
]

export function providerSpec(value: string): EmbeddingProviderSpec | undefined {
  return embeddingProviders.find((p) => p.value === value)
}

/** Default output dimension for a provider's model, or undefined when unknown. */
export function defaultDimensions(provider: string, modelId: string): number | undefined {
  const id = modelId.trim().toLowerCase()
  return providerSpec(provider)?.models.find((m) => m.id.toLowerCase() === id)?.dimensions
}
