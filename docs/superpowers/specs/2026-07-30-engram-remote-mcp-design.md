# Engram — Authenticated Remote MCP Server Design

**Date:** 2026-07-30  
**Status:** Proposed design, ready for implementation  
**Scope:** Read-only access to the authenticated user's Engram transcripts and
existing enhancements from Codex, Claude Code, and compatible MCP hosts.

This design refines Phase 5 of the unified-auth plan. The unified-auth security
invariants remain authoritative; this document locks the MCP-specific product,
tool, transport, and rollout decisions.

## Readiness decision

Engram is ready to implement the MCP server now:

- owner-scoped recording, transcript, enhancement, speaker, and search stores
  already exist;
- OAuth 2.1, PKCE, DCR, audience separation, renewable grants, connection
  identity, and per-connection revocation are implemented;
- the canonical MCP resource is already frozen as `${APP_URL}/mcp`;
- the MCP-only scope allowlist is already frozen as
  `transcripts:search transcripts:read offline_access`;
- `/mcp` already bypasses the browser-login proxy; the endpoint is not yet
  implemented, and the provisioned production flag is `MCP_ENABLED=false`;
- `@modelcontextprotocol/sdk@1.29.0` and Zod 4 are already installed.

Implementation and non-production validation may begin immediately. Production
enablement remains a separate decision: the current legacy-auth rollback
observation window runs through 2026-08-24. Until that gate is explicitly
closed or shortened, deploy the implementation with `MCP_ENABLED=false`.

## Product boundary

### Primary archetype

`tool-only`. Engram is a private, read-only knowledge source. A widget would add
surface area without improving the first user goals: find a meeting, retrieve
its source transcript, or inspect its existing notes.

### Supported V1 user goals

1. Find recordings where a subject, decision, person, or phrase appears in the
   source transcript or Engram's generated notes.
2. Open a cited recording at the most relevant timestamp.
3. Retrieve the source transcript with timestamps and resolved speaker names.
4. Continue through a long transcript without an unbounded response.
5. Retrieve Engram's already-generated overview, decisions, action items,
   chapters, key points, and open questions.

### Explicitly out of scope

- uploads, deletes, retries, regeneration, speaker edits, or any other mutation;
- raw audio, presigned URLs, storage keys, backups, settings, credentials, or
  Plaud operations;
- a ChatGPT widget or MCP Apps UI resource;
- Ask-Engram/RAG answer generation inside the MCP server;
- anonymous access, cookie authentication, static bearer tokens, or service
  credentials;
- public plugin-directory submission in this slice.

## Architecture

```text
Codex / Claude Code / MCP host
  -> HTTPS Streamable HTTP /mcp
  -> MCP feature gate
  -> OAuth bearer verification
       issuer + EdDSA signature + expiry
       exact audience = ${APP_URL}/mcp
       active connection/grant
  -> per-tool scope + rate-limit policy
  -> owner-scoped Engram domain services
       transcript hybrid search
       generated-note search
       latest transcript + speaker map
       latest enhancement
  -> bounded MCP result with canonical recording URL
```

Use a fresh `McpServer` and
`WebStandardStreamableHTTPServerTransport` for each request. Run the transport
in stateless JSON-response mode (`sessionIdGenerator: undefined`,
`enableJsonResponse: true`). Engram has no V1 server-side MCP session state, so
an in-memory session registry would only complicate Railway deploys and
horizontal scaling.

The Next.js route must use Web `Request`/`Response` directly. Do not adapt the
Node `IncomingMessage` transport inside an App Router Route Handler.

## Tool contract

The first two tools use the standard connector `search` and `fetch` shapes.
This keeps Engram compatible with hosts that understand read-only knowledge
sources without duplicating them as `search_transcripts` and `get_transcript`.
The two Engram-specific tools complement that standard surface.

All tools declare:

```ts
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
}
```

### 1. `search`

**Use this when** the user wants to find Engram recordings by topic, phrase,
person, decision, or other remembered content.

- Input: exactly `{ query: string }`.
- Validation: trim; 1-500 characters.
- Scope: `transcripts:search`.
- Search both corpora:
  - source transcript passages through the existing hybrid search;
  - the latest generated enhancement's overview, key points, decisions, action
    items, chapters, and open questions through owner-scoped weighted full-text
    search.
- Fuse both ranked lists, group matches by recording, and return at most eight
  recordings. Keep up to three bounded evidence snippets per recording.
- Output: exactly one MCP text content item whose text is JSON encoding:

```ts
type SearchOutput = {
  results: Array<{
    id: string                 // recording UUID
    title: string
    url: string                // absolute /recordings/:id?t=:seconds URL
    createdAt: string          // ISO-8601
    snippets: Array<{
      text: string             // plain text, never ts_headline HTML
      source:
        | "transcript"
        | "overview"
        | "key_point"
        | "decision"
        | "action_item"
        | "chapter"
        | "open_question"
      generated: boolean       // false only for transcript evidence
      startSeconds: number | null
      endSeconds: number | null
    }>
  }>
}
```

The standard fields are `id`, `title`, and `url`; the remaining fields are
bounded Engram metadata. Convert the existing sanitized HTML snippet back to a
plain-text representation at the domain boundary or expose a plain snippet
from the search store. Never return `<mark>` markup to an MCP client. Generated
matches must remain visibly distinct from transcript evidence in both the
payload and any model-facing text. A chapter may deep-link to its recorded
`startSeconds`; other generated-note matches link to the recording without
inventing a timestamp.

V1 does not need a second semantic-embedding pipeline for generated notes.
Those fields are concise and structured, so a generated `tsvector` plus GIN
index and weighted `websearch_to_tsquery` ranking is sufficient initially.
The existing semantic transcript search still provides topic-level recall.
Add enhancement embeddings later only if evaluation shows a measurable recall
gap; do not generalize `transcript_embeddings` speculatively.

### 2. `fetch`

**Use this when** the user or model has a recording ID from `search` and needs a
citable source document.

- Input: exactly `{ id: string }`, where `id` is a recording UUID.
- Scope: `transcripts:read`.
- Load: latest owner-scoped transcript plus resolved speaker names.
- Output: exactly one MCP text content item whose text is JSON encoding:

```ts
type FetchOutput = {
  id: string
  title: string
  text: string
  url: string
  metadata: {
    createdAt: string
    durationSeconds: number | null
    language: string | null
    segmentCount: number
    returnedSegmentCount: number
    truncated: boolean
    nextCursor: string | null
  }
}
```

Format `text` as plain lines such as
`[00:12.400–00:18.050] Jeremy: transcript text`. Return at most 48,000 UTF-8
bytes and 160 segments, whichever comes first. If more content exists, set
`truncated=true` and supply `nextCursor` for `get_transcript_page`.

Unknown, malformed, or cross-owner IDs produce the same not-found tool error.

### 3. `get_transcript_page`

**Use this when** `fetch` reports a truncated transcript or the user needs
precise timestamped segments from a long recording.

- Input:
  - `recordingId`: UUID, required;
  - `cursor`: opaque string returned by Engram, optional;
  - `limit`: integer 1-100, optional, default 50.
- Scope: `transcripts:read`.
- Output schema and `structuredContent`:

```ts
type TranscriptPageOutput = {
  recording: {
    id: string
    title: string
    url: string
    createdAt: string
    language: string | null
  }
  segments: Array<{
    index: number
    startSeconds: number
    endSeconds: number
    speaker: string | null
    text: string
    url: string
  }>
  nextCursor: string | null
}
```

The cursor contains a version, latest-transcription ID, and segment offset in a
base64url JSON envelope. Treat it as untrusted: validate its shape, verify that
the transcription is still the latest owner-scoped row for the recording, and
return a stale-cursor error if the recording has been retranscribed. Cursor
contents never grant access.

Cap the serialized result at 48,000 UTF-8 bytes even when `limit` would permit
more. Always make forward progress by returning at least one valid segment
unless that single stored segment itself exceeds the hard cap; in that case
return a bounded error rather than silently slicing transcript text.

### 4. `get_summary`

**Use this when** the user asks for Engram's existing meeting notes, decisions,
actions, chapters, or open questions and already has a recording ID.

- Input: `{ recordingId: string }`.
- Scope: `transcripts:read`.
- Load: latest owner-scoped `aiEnhancements` row; do not call a model or
  regenerate anything.
- Output schema and `structuredContent`:

```ts
type SummaryOutput = {
  recording: { id: string; title: string; url: string; createdAt: string }
  overview: string
  keyPoints: string[]
  decisions: string[]
  actionItems: Array<{ text: string; owner: string | null; due: string | null }>
  chapters: Array<{
    title: string
    gist: string
    startSeconds: number | null
    url: string | null
  }>
  openQuestions: string[]
}
```

Cap the serialized response at 48,000 UTF-8 bytes. Existing summary payloads
should fit comfortably; an oversized stored enhancement returns a bounded
error and is logged without its content.

## Server instructions

Keep initialization instructions short and operational:

> Engram contains the authenticated user's private meeting transcripts and
> existing meeting notes. Search before fetching unless a recording ID is
> already known. Use get_transcript_page only to continue a truncated fetch.
> Every tool is read-only; Engram cannot expose audio or mutate recordings.

The most important guidance stays within the first 512 characters. Tool
descriptions remain authoritative for tool selection.

## Authentication and authorization

### Transport boundary

Every `/mcp` request must:

1. fail with `404` while `MCP_ENABLED !== "true"`;
2. reject token-like query parameters;
3. require an `Authorization: Bearer ...` header before consulting cookies;
4. verify an OAuth principal with mechanism `oauth`;
5. verify exact audience `${APP_URL}/mcp`;
6. verify the connection is active;
7. never forward the bearer token to any domain service or downstream API.

Missing, malformed, expired, revoked, wrong-issuer, or wrong-audience tokens
return `401` with an RFC 9728 `WWW-Authenticate` challenge containing
`resource_metadata="${APP_URL}/.well-known/oauth-protected-resource/mcp"`.
Browser sessions and the legacy Mac token are never accepted at `/mcp`.

### Tool boundary

Declare an OAuth `securitySchemes` entry on every tool with its exact scope and
mirror it in `_meta["securitySchemes"]` for compatibility. The installed
`@modelcontextprotocol/sdk@1.29.0` high-level `McpServer` API currently exposes
the `_meta` mirror but not the newer top-level field in its `registerTool`
types. Implement with the mirror, then either upgrade to a version that emits
the documented top-level field or use a small, tested descriptor adapter when
ChatGPT app validation enters scope; do not use an unsafe type cast that the
SDK silently drops. Codex and Claude Code authentication still begins at the
transport's HTTP `401` challenge.

Recheck the principal's scopes in each handler. A valid token missing the tool
scope returns an MCP `isError` result with
`_meta["mcp/www_authenticate"]` carrying an `insufficient_scope` challenge and
the minimum scope. This follows current host behavior more reliably than
trying to infer a tool call and return an HTTP `403` before the MCP transport
parses JSON-RPC.

### Protected-resource metadata

Add `GET /.well-known/oauth-protected-resource/mcp`, gated by both OAuth and
MCP feature flags, advertising:

- resource: `${APP_URL}/mcp`;
- authorization server: `${APP_URL}/api/auth`;
- scopes: `transcripts:search`, `transcripts:read`, `offline_access`;
- bearer method: `header` only;
- cache: `public, max-age=300` while enabled.

The existing DCR allowlist remains unchanged. Do not introduce a manual token
fallback.

## Domain-service changes

Keep protocol code free of SQL. Add owner-scoped helpers that are independently
unit-testable:

- `searchEngramDocuments(ownerId, query, limits)` fuses existing transcript
  passage hits with weighted matches from the latest generated enhancement,
  groups them into recording documents, and emits provenance-labelled plain
  snippets;
- `getOwnedTranscriptDocument(ownerId, recordingId)` returns the latest
  transcription and recording metadata;
- `getOwnedTranscriptPage(ownerId, recordingId, cursor, limit)` applies cursor
  validation and speaker-name resolution;
- `getOwnedSummary(ownerId, recordingId)` returns the latest enhancement.

Reuse `getOwnedRecordingBundle`, `searchRecordings`, and
`getRecordingSpeakerMap` underneath these helpers where practical. Add an
indexed search vector for generated enhancements rather than scanning JSON
payloads on every MCP call. Only the latest enhancement per owner-scoped
recording participates in results. Every query must begin from `ownerId`;
filtering a global result after retrieval is not an authorization boundary.

## Limits, cost controls, and rate limiting

| Boundary | V1 limit |
|---|---:|
| Request `Content-Length` | 256 KiB |
| Search query | 500 characters |
| Search passage candidates | 12 |
| Search recording results | 8 |
| Snippets per recording | 3 |
| Transcript page request | 100 segments |
| Tool payload | 48,000 UTF-8 bytes |
| Search timeout | 15 seconds |
| Read/summary timeout | 5 seconds |
| Concurrent tool work per request | 1 operation |

Search can invoke the configured embedding provider, so apply a lower limit to
it than to database-only reads. Before production enablement, add a durable
Postgres fixed-window limiter keyed by a SHA-256 digest of
`userId + clientId + tool`:

- `search`: 20 calls/minute;
- `fetch`: 60 calls/minute;
- `get_transcript_page`: 60 calls/minute;
- `get_summary`: 60 calls/minute.

Use one small upserted bucket row per key and window; do not store queries or
results in the limiter. Add opportunistic cleanup for expired buckets. A
process-local-only limiter is not sufficient for a multi-replica deployment.

## Errors

Use stable, non-disclosing tool error categories:

- `invalid_input` — schema, cursor, or bounds failure;
- `not_found` — missing and cross-owner recording IDs;
- `stale_cursor` — transcript changed since a cursor was issued;
- `rate_limited` — include a bounded retry-after hint;
- `response_too_large` — one stored item cannot be returned safely;
- `temporarily_unavailable` — timeout or dependency failure.

Do not return stack traces, SQL, provider errors, storage identifiers, or
transcript content in errors. MCP protocol parse/validation errors remain JSON-
RPC errors produced by the SDK.

## Observability

Emit one structured `mcp_tool_call` event per completed tool call with:

- request ID, tool name, duration, outcome, result count/bytes;
- user ID, client ID, and connection ID (or stable hashes if logs leave the
  trusted deployment boundary);
- rate-limit outcome and error category when relevant.

Never log access/refresh tokens, OAuth codes, search queries, transcript text,
snippets, summaries, speaker names, or tool payloads. Log initialization and
transport failures separately without request bodies.

## File shape

```text
app/
  mcp/route.ts
  .well-known/oauth-protected-resource/mcp/route.ts
lib/mcp/
  auth.ts
  errors.ts
  limits.ts
  rate-limit.ts
  server.ts
  transport.ts
  tools/
    search.ts
    fetch.ts
    get-transcript-page.ts
    get-summary.ts
  *.test.ts
lib/recordings/store.ts                 # owner-scoped transcript/summary reads
lib/search/search.ts                    # transcript search + result fusion
lib/search/enhancements.ts              # generated-note full-text search
db/schema.ts                            # enhancement search vector + rate limiter
drizzle/                                # additive search/limiter migration
proxy.ts                                # already bypasses /mcp; verify only
.env.example
DEPLOY.md
README.md
PROGRESS.md
```

Keep the repository root-based; do not introduce `src/` or a separate server
process. Do not add `@modelcontextprotocol/ext-apps` because V1 has no UI.

## Verification

### Automated

- feature-off MCP and metadata routes return `404`;
- cookie-only and missing bearer requests return `401`, never a login redirect;
- initialize succeeds with a valid MCP-audience token;
- `tools/list` exposes exactly the four read-only tools with titles,
  descriptions, schemas, annotations, and per-tool OAuth security schemes;
- `search` and `fetch` match the standard content shapes;
- search covers transcript and generated-note fields, labels provenance, uses
  only the latest enhancement, and never fabricates timestamps for notes;
- wrong API audience, missing scope, inactive connection, and token query
  parameters fail correctly;
- handlers always pass `principal.userId` to domain services;
- cross-owner IDs are indistinguishable from missing IDs;
- cursor round-trip, tamper, stale-transcript, pagination, byte caps, and
  oversized-single-segment behavior are covered;
- rate-limit buckets are atomic and isolated by user/client/tool;
- tool inventory contains no write, audio, storage, Plaud, settings, or backup
  capability;
- logs contain metadata but not representative private content or credentials.

Run:

```bash
pnpm test lib/mcp
pnpm test lib/search/search.test.ts lib/recordings/store.test.ts
pnpm test
pnpm typecheck
pnpm build
```

### Local protocol loop

1. Run Engram locally with MCP enabled and a disposable database/user.
2. Inspect `/mcp` with MCP Inspector using Streamable HTTP.
3. Verify initialize, tool descriptors, valid calls, invalid inputs, scope
   challenges, and output bounds.
4. Confirm `/mcp` never emits login HTML and `.well-known` metadata resolves.

### Hosted client loop

On staging or production only after its enablement gate:

1. Add `${APP_URL}/mcp` to Codex; complete browser OAuth; search and fetch.
2. Quit/restart the client and verify refresh survives.
3. Revoke the connection in Engram Settings and confirm the next request fails.
4. Reauthorize and confirm access returns under a new active connection.
5. Repeat the same lifecycle in Claude Code.
6. If ChatGPT Developer Mode is tested, refresh the app after every descriptor
   change so it reloads the tool catalog.

## Rollout

### Release A — implementation dark

- merge code, additive limiter migration, docs, and tests;
- deploy with `MCP_ENABLED=false`;
- confirm existing web, OAuth Mac, search, and recording flows are unchanged;
- confirm production `/mcp` and MCP protected-resource metadata remain `404`.

### Release B — staging/dogfood

- enable MCP in a disposable or staging environment;
- pass Inspector, Codex, and Claude Code OAuth lifecycles;
- measure search latency, payload sizes, rate limits, and error logs;
- keep all tools read-only and schemas backward compatible.

### Release C — production enablement

Enable only when:

- the legacy-auth rollback observation gate is closed (currently 2026-08-24)
  or explicitly revised;
- routine OAuth Mac use remains healthy with legacy auth disabled;
- automated verification is green;
- Codex and Claude Code pass login, refresh, revoke, and reauthorize on the
  deployed endpoint;
- rollback is one environment change: set `MCP_ENABLED=false` and redeploy.

Disabling MCP must not disable the shared OAuth server or affect the Mac app.
The additive rate-limit table can remain during rollback.

## Implementation order

1. Add MCP feature helper, protected-resource metadata, strict bearer-only MCP
   auth, and route-level tests.
2. Add owner-scoped transcript document/page/summary services and cursor tests.
3. Add indexed generated-note search, transcript/note result fusion, and
   provenance tests.
4. Add `search` and `fetch` tool handlers with standard output contracts.
5. Add `get_transcript_page` and `get_summary` with output schemas and caps.
6. Wire the stateless Web Standard transport and protocol-level tests.
7. Add the durable rate limiter, structured private-safe logging, and timeouts.
8. Update deployment/setup docs and record the dark deployment.
9. Run the local Inspector loop, then the hosted Codex and Claude Code gates.

## Compatibility rule

Tool names and existing required fields become a public contract once a real
host connects. After that point, evolve additively: add optional fields or new
tools, but do not rename `search`, `fetch`, `get_transcript_page`, or
`get_summary`, change their meanings, or remove fields without a versioned
migration and client revalidation.

## References

- [OpenAI: Build an MCP server](https://developers.openai.com/plugins/build/mcp-server)
- [OpenAI: Define tools](https://developers.openai.com/plugins/plan/tools)
- [OpenAI: Authenticate users](https://developers.openai.com/plugins/build/auth)
- [OpenAI: Plugin reference](https://developers.openai.com/plugins/reference)
- [OpenAI: Apps SDK quickstart](https://developers.openai.com/apps-sdk/quickstart)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
