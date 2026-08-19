<div align="center">

# FloMorphic

**The visual workflow builder for AI-native systems.**

Compose AI harnesses, loop systems, and workflow graphs on a canvas — built on the
[Inflowenger](https://inflowenger.com) context runtime.

`Vue 3` · `Vite` · `TypeScript` · `Vue Flow` · `Tailwind v4` · `Pinia`

</div>

---

## What is FloMorphic?

FloMorphic is the front-end for building **AI-native workflows** on Inflowenger — a runtime
whose logic *is* a workflow graph. You drag intent-level nodes (agents, models, tools,
retrievers, loops, guardrails, integrations) onto a canvas, wire them together, and the
backend compiles that graph down to Inflowenger's small set of runtime primitives.

> **Context is the memory. Workflows are the logic. Fractals are the processors.**

Where the low-level [`flomorphic-api`](../inflow-vue/flomorphic-api) edits the raw runtime
primitives, FloMorphic is the **product layer**: its nodes speak the language of *what you want
to build*, and each one records which primitive(s) it lowers to on compile. AI is treated as a
capability *within* the execution model — not the center of it — so FloMorphic is useful without
AI and increasingly powerful with it.

## The compile model

Every FloMorphic node is a declarative, static front-end node. At save time the graph is
persisted verbatim as `view_flow`; the backend's `vueFlow` compiler walks it and lowers each
node to one of six Inflowenger primitives:

| Primitive | Role |
| --- | --- |
| **Void** | No-op / structure — start markers, joins, dead-ends |
| **Code** | Computation — run JS / OPA against scoped context |
| **Contract** | Decision — emit tags, fire matching branches |
| **Extrinsic** | Call your own backend over a NATS subject |
| **Plugin** | A live external process — the escape hatch to the outside world |
| **GoTo** | Composition / reuse — jump into another flow and return |

### FloMorphic's node palette

The canvas ships higher-level, AI-native nodes grouped by intent — each annotated with its
compile target:

- **Triggers** — Manual Trigger `→ Void`, Webhook `→ Plugin`, Schedule `→ Plugin`
- **AI Harness** — LLM (with bound tools) `→ Plugin`, Tool `→ Plugin·Extrinsic`,
  MCP client `→ Plugin`, Retriever `→ Plugin`, Memory `→ Plugin·Code`, Guardrail `→ Code·Contract`
- **Logic & Flow** — Condition `→ Contract`, Transform `→ Code`,
  Human in the Loop `→ Extrinsic`, Merge `→ Void`
- **Integrations** — HTTP Request `→ Plugin`, Extrinsic `→ Extrinsic`, Plugin `→ Plugin`,
  Sub-workflow `→ GoTo`, Output `→ Code·Void`

Every node shares three universal fields, mirrored on the compiled node: **title** (label),
**key** (where its output is written into context), and **scope** (the JSONPath slice of context
it reads / writes).

> **There is no Loop node — by design.** A loop is not a primitive here; it emerges from
> connections. An **LLM** node appends to the message stack on the context, a **Condition**
> (Contract) checks whether the task is satisfied, and if not an edge routes back to the LLM.
> That cycle *is* the loop.

## Features (base plate)

- 🎨 **Visual canvas** — drag-and-drop workflow editor powered by [Vue Flow](https://vueflow.dev),
  with a draggable node palette, live node inspector, minimap and controls.
- 🧩 **Catalog-driven nodes** — a single generic renderer + a typed node catalog; adding a node
  kind is a catalog entry, not a new component.
- 💾 **Runs standalone or connected** — with no backend it persists workflows to `localStorage`;
  point it at `flomorphic-api` and the same code path talks to the real runtime.
- 🌗 **Light / dark / system theming** — Tailwind v4 with runtime CSS design tokens.
- 🧩 **Extensions manager** — register an extension from a Git repo + env; the backend clones and
  runs it so it joins the inflow ecosystem and contributes plugin nodes to the palette.
- 🧠 **Memory stores** — define reusable **Vector** stores (embedding model + token, dimensions,
  metric) and **Document** stores (table + column schema); the Memory node references one by id.
- 🧭 **Full app shell** — collapsible sidebar, routing, and sections for Workflows, Extensions,
  Memory and Contexts.

> Workflow and memory-store lists are served by the backend API (`/flow`, `/memory`,
> `/extension`). With no backend configured the app falls back to browser-local persistence so it
> still runs standalone.
- 📦 **Portable SPA** — hash routing + relative base, so it serves from any static host, a
  sub-path, `file://`, or an Electron shell — local or online.

## Quick start

```bash
# Install dependencies (pnpm recommended)
pnpm install

# Start the dev server
pnpm dev

# Type-check + production build
pnpm build

# Preview the production build
pnpm preview
```

Open the printed local URL. With no backend configured, FloMorphic runs standalone and stores
your workflows in the browser.

### Connecting a backend

FloMorphic talks to the Inflowenger `flomorphic-api`. Copy `.env.example` to `.env` and set:

```bash
VITE_API_BASE_URL=http://localhost:9000   # your flomorphic-api base URL
```

When set, the header shows **Connected** and workflow list/read/save/delete go through the API
(`/flow`, `/flow/id/:id`), with `Run` enabled against the process endpoints (`/ps`).

### In Docker

```sh
docker build -t flomorphic-wapp:local .
docker run --rm -p 8090:80 --network inflow_net \
  -e API_UPSTREAM=http://flomorphic-api:8025 flomorphic-wapp:local
```

`VITE_API_BASE_URL` is baked at build time, so baking a host name would tie one
image to one machine and bring CORS along with it. This image bakes a **relative**
base (`/api`) instead, and nginx proxies `/api/*` and `/ws/*` to `API_UPSTREAM`,
read at container start. One port, same origin, no CORS — and the same image runs
on a laptop, a LAN box or a server. For a backend this container cannot itself
reach, build with an absolute base instead:

```sh
docker build --build-arg VITE_API_BASE_URL=https://api.example.com -t flomorphic-wapp:local .
```

For the whole product in one container — canvas, API and plugin nodes — see
[FloMorphic/getting-started](https://github.com/FloMorphic/getting-started).

## Project structure

```
src/
├── api/            # Typed flomorphic-api client + repositories (backend or local)
├── assets/         # Vue Flow theme overrides
├── components/
│   ├── flow/       # Canvas, palette, node inspector, generic FlowNode
│   ├── layout/     # Header, sidebar, theme toggle, app shell
│   └── ui/         # Icon, Button, PageShell, EmptyState, …
├── data/           # nodeCatalog.ts — the FloMorphic node model
├── lib/            # icons, id, localStorage helpers
├── router/         # Hash-history routes
├── stores/         # Pinia: workflows, ui (theme + sidebar)
├── types/          # Wire types mirroring the Go backend models
└── views/          # Route pages (Workflows, Editor, Extensions, Memory, Contexts, …)
```

## Tech decisions

- **Vue SPA over Nuxt** — FloMorphic is a canvas-heavy, real-time editor. SSR adds little (the
  canvas can't meaningfully server-render), while a static SPA runs equally well local or online.
  It also shares the exact stack of `flomorphic-api`, so patterns transfer directly.
- **Tailwind v4 + design tokens** — utilities for speed, runtime CSS variables for theming, so
  light/dark are a token swap rather than a duplicated stylesheet.
- **Self-contained icons** — an inline-SVG set (no icon CDN) keeps the app fully offline-capable.

## Part of the Inflowenger platform

FloMorphic is the workflow-builder surface of the Inflowenger ecosystem:

- **Inflowenger** — the context runtime: workflow graphs, contexts, fractals.
- **flomorphic-api** — the backend FloMorphic connects to (flows, contexts, extensions, processes).
- **inflow-plugin-sdk** — build plugins against the InflowV1 protocol; each becomes a palette node.

---

<div align="center">
<sub>© 2026 Inflowenger · Where context becomes computation.</sub>
</div>
