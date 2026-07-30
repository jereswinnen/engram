# Engram

Engram turns recorded meetings into diarized transcripts, searchable passages, and
structured meeting notes. It runs as a Next.js application with Postgres, Cloudflare
R2, ElevenLabs Scribe, and OpenAI, and is deployed on Railway.

## Development

Requirements: Node.js 22.13 or newer, pnpm 11, and Postgres with the `vector`
extension.

```bash
cp .env.example .env.local
pnpm install
pnpm db:migrate
pnpm dev
```

Useful verification commands:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

See [DEPLOY.md](DEPLOY.md) for Railway setup, migrations, OAuth rollout, and
operational checks.

## Authenticated MCP server

Engram exposes an optional remote Streamable HTTP MCP endpoint at `/mcp`. It is a
private, read-only knowledge source for Codex, Claude Code, and compatible MCP
hosts. OAuth bearer authentication is mandatory; browser cookies, the legacy Mac
token, raw audio, and mutations are not accepted.

The four tools are:

- `search`: searches transcript passages and the latest generated overview, key
  points, decisions, actions, chapters, and open questions, with explicit source
  provenance;
- `fetch`: returns a bounded timestamped source transcript;
- `get_transcript_page`: continues long transcripts with an opaque cursor;
- `get_summary`: returns Engram's existing notes without calling a model.

The server is dark unless both the OAuth foundation is available and
`MCP_ENABLED=true`. Keep the Railway deployment at `MCP_ENABLED=false` until the
staging and rollout gates in [DEPLOY.md](DEPLOY.md#authenticated-engram-mcp-server)
pass.

Once a hosted environment is enabled, configure Codex:

```bash
codex mcp add engram \
  --url https://<host>/mcp \
  --oauth-resource https://<host>/mcp
codex mcp login engram \
  --scopes transcripts:search,transcripts:read,offline_access
```

Configure Claude Code against the same endpoint:

```bash
claude mcp add --transport http --scope user engram https://<host>/mcp
claude mcp login engram
```

Both hosts complete OAuth in the browser. Do not configure a static bearer token.

## Project notes

- The repository is root-based: `app/`, `lib/`, `db/`, and `components/` are not
  nested under `src/`.
- Use `pnpm dlx shadcn@latest add <component>` when adding shadcn/ui components.
- Design specifications live in `docs/superpowers/specs/`; the MCP design is
  [2026-07-30-engram-remote-mcp-design.md](docs/superpowers/specs/2026-07-30-engram-remote-mcp-design.md).
