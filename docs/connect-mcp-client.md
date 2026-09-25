# Drive FloMorphic from your own AI client

Every FloMorphic API endpoint has a mirror on an **MCP server** this install
serves at `/mcp`. Point an MCP client at it and that client can do what the API
can: draft a workflow, run one, read a run's context, manage prompts and
triggers, create a node's settings profile from credentials you paste in.

This is the way to use a **Claude Pro / Max or ChatGPT Plus subscription** with
FloMorphic. Those plans are not API keys and no endpoint accepts one, so nothing
running inside FloMorphic can use them. But your desktop client is already signed
in to that subscription, and it can connect here.

> Don't want to set anything up on your machine? **AI build** in the canvas
> toolbar needs no client and no backend: it hands you a prompt built from this
> install's node catalog, and validates and previews the graph you paste back.

## What you need

- **The endpoint**: `http://<your-flomorphic-host>:8025/mcp`
  (`http://localhost:8025/mcp` when it runs on your own machine). The port is
  whatever `PORT` is set to; `8025` is the default.
- **Transport**: streamable HTTP. Not stdio, not SSE.
- **A bearer token** — only if the install runs with `AUTH_ENABLED=true`. Most
  local and single-tenant installs do not.

Check it is up before configuring anything:

```bash
curl -i -X POST http://localhost:8025/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```

A JSON-RPC result naming `flomorphic` means you are ready. A connection refused
means the API is not running or not reachable at that address; a 404 means
`MCP_ENABLED` is off.

## Claude Code

One command:

```bash
claude mcp add --transport http flomorphic http://localhost:8025/mcp
```

With auth on:

```bash
claude mcp add --transport http flomorphic http://localhost:8025/mcp \
  --header "Authorization: Bearer <token>"
```

Check it with `claude mcp get flomorphic`, then start Claude Code and ask it to
list your workflows.

## Claude Desktop

Settings → Developer → Edit Config, which opens `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "flomorphic": {
      "type": "http",
      "url": "http://localhost:8025/mcp"
    }
  }
}
```

Restart Claude Desktop. FloMorphic's tools appear under the tools icon.

If your version does not accept `"type": "http"` — older builds only spoke
stdio — bridge it:

```json
{
  "mcpServers": {
    "flomorphic": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://localhost:8025/mcp"]
    }
  }
}
```

## Codex CLI

In `~/.codex/config.toml`:

```toml
[mcp_servers.flomorphic]
url = "http://localhost:8025/mcp"
```

## Cursor

Create `.cursor/mcp.json` in your project (or use the global config):

```json
{
  "mcpServers": {
    "flomorphic": {
      "url": "http://localhost:8025/mcp"
    }
  }
}
```

## Any other MCP client

Give it the URL and tell it the transport is streamable HTTP. Nothing here is
FloMorphic-specific beyond the address.

## First things to ask

Once connected, these exercise the main surfaces:

- *"List my FloMorphic workflows."*
- *"Get the design guide, then draft a flow that fetches a URL daily and stores
  the result."* — the guide is an MCP prompt the server exposes, and it carries
  the full authoring rules, so ask for it before asking for a flow.
- *"Run the flow called X, then show me its context when it finishes."*
- *"Create a settings profile for my HTTP node with this base URL and token:
  …"* — pasting JSON works; the client picks the right tool.

## Notes

- **Your client decides what to approve.** Claude Desktop and Claude Code prompt
  before each tool call. Approvals are theirs, not FloMorphic's.
- **Writes are real.** An MCP write is indistinguishable from the same change
  made in the canvas — same code path, same validation. Ask for a plan
  (`flo_plan_patch`) rather than an apply if you want to see it first.
- **Don't edit a flow you have open in the canvas.** The browser holds unsaved
  state the client cannot see, and whichever saves last wins. Close the tab or
  save first.
- **Reaching a remote install** needs the address to be reachable from your
  machine, and `AUTH_ENABLED=true` with a token in the header. Do not expose
  `/mcp` to the internet unauthenticated — it is full write access to the install.
