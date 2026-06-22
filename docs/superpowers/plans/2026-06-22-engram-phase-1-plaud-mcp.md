# Engram Phase 1 (redo) — Official Plaud MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Engram's reverse-engineered Plaud sync with the official Plaud MCP (`mcp.plaud.ai`, OAuth PKCE via `@modelcontextprotocol/sdk`), reusing the existing sync orchestration, durability fixes, `/api/sync` route, and Settings shell.

**Architecture:** A new modular `lib/plaud/mcp/` (types+parsing, encrypted OAuth auth-store, OAuth provider, MCP-SDK client) replaces the REST client + pasted-token store. `lib/plaud/sync.ts` is adapted to call the MCP client (data-source swap only — dedup/checkpoint/durability unchanged). Interactive OAuth via new `connect`/`callback`/`disconnect` routes; Settings swaps the paste-token widget for Connect/Disconnect.

**Tech Stack:** Next.js 16 (App Router) + TS, pnpm, `@modelcontextprotocol/sdk`, Drizzle + postgres.js, Vitest. Reuses `lib/storage` (R2), `lib/pipeline`, `lib/crypto/secrets`, `lib/auth-guard`, `auth.ts`.

**Spec:** `docs/superpowers/specs/2026-06-22-engram-phase-1-plaud-mcp-design.md`

## Global Constraints

- **pnpm only.** Conventional commits. Code clean/modern/performant/efficient and **modular** (one responsibility per file).
- **Next.js 16:** `proxy.ts` not `middleware.ts`; dynamic route `params`/`searchParams` are Promises (awaited); `auth.api.getSession({ headers: request.headers })` is the established gate. OAuth `connect` must be a top-level browser navigation (anchor/redirect), not `fetch`. Read `node_modules/next/dist/docs/` before Next-specific code.
- **Root-level layout** (no `src/`); `@/* → ./*`.
- **Sequencing keeps the build green:** the MCP layer is added first (Tasks 1–3), `sync.ts` is swapped to it (Task 4), then the reverse-engineered files are deleted (Tasks 4–5). Don't delete a module while something still imports it.
- **No new DB migration** — reuse `api_credentials` (encrypted OAuth JSON), `sync_state`+`lastResult`, `recordings`.
- **No live Plaud/DB/keys in the build env.** Unit-test only; OAuth handshake + full sync are verified live during execution (the user is connected with a recording).
- **TDD** where a test is specified. **Reuse, don't reinvent** (R2/pipeline/crypto/auth).
- The MCP server is `https://mcp.plaud.ai/mcp` (streamable HTTP). OAuth `scope`/dynamic-client-registration are verified at the live Connect step (the provider supports DCR with a manual-seed fallback).

## File Structure

```
lib/plaud/mcp/
  types.ts          # PlaudFile/PlaudFileDetail + parseToolJson + mapFile/mapFileDetail
  auth-store.ts     # encrypted OAuth state in api_credentials (tokens/clientInfo/codeVerifier/authUrl)
  oauth-provider.ts # PlaudOAuthProvider implements OAuthClientProvider
  client.ts         # connect/finishAuth/beginAuth/isConnected/disconnect/listFiles/getFile/downloadAudio
  types.test.ts
  auth-store.test.ts
  client.test.ts
lib/plaud/sync.ts          # adapted: calls mcp/client (durability logic unchanged)
lib/plaud/sync.test.ts     # adapted: mocks ./mcp/client
app/api/plaud/connect/route.ts    # GET → redirect to Plaud authorize URL
app/api/plaud/callback/route.ts   # GET ?code= → finishAuth → redirect /settings
app/api/plaud/disconnect/route.ts # POST → clear tokens
app/api/sync/route.ts             # unchanged
app/settings/page.tsx             # isConnected() + searchParams; passes oauthStatus
app/settings/plaud-settings.tsx   # Connect/Disconnect + status + Sync now
lib/config.ts                     # + plaudRedirectUrl(); - plaudApiBase (Task 4)
REMOVED (Tasks 4–5): lib/plaud/client.ts(+test), lib/plaud/credentials.ts, app/api/plaud/token/route.ts
```

---

### Task 1: Dependency + config + MCP types/parsing

**Files:**
- Modify: `lib/config.ts`, `lib/config.test.ts`, `package.json` (dep)
- Create: `lib/plaud/mcp/types.ts`, `lib/plaud/mcp/types.test.ts`

**Interfaces:**
- Produces: `config.plaudRedirectUrl(): string` = `${NEXT_PUBLIC_APP_URL}/api/plaud/callback`. `PlaudFile { fileId; name; startAtMs; durationMs?; trashed }`, `PlaudFileDetail extends PlaudFile { presignedUrl }`, `parseToolJson<T>(result): T`, `mapFile(raw): PlaudFile`, `mapFileDetail(raw): PlaudFileDetail`.

- [ ] **Step 1: Install the MCP SDK**

```bash
pnpm add @modelcontextprotocol/sdk
```

- [ ] **Step 2: Write the failing config test**

Add to `lib/config.test.ts`:
```ts
describe("plaudRedirectUrl", () => {
  it("derives the callback URL from NEXT_PUBLIC_APP_URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://engram.example";
    expect(config.plaudRedirectUrl()).toBe("https://engram.example/api/plaud/callback");
  });
});
```
(Keep the existing `plaudApiBase` tests for now — removed in Task 4.)

- [ ] **Step 3: Run test → fails**

Run: `pnpm test lib/config.test.ts`
Expected: FAIL (`config.plaudRedirectUrl is not a function`).

- [ ] **Step 4: Add the config getter**

In `lib/config.ts`, add (leave `plaudApiBase` for now):
```ts
  plaudApiBase: () => process.env.PLAUD_API_BASE ?? "https://api.plaud.ai",
  plaudRedirectUrl: () => `${required("NEXT_PUBLIC_APP_URL")}/api/plaud/callback`,
```

- [ ] **Step 5: Run config test → passes**

Run: `pnpm test lib/config.test.ts`
Expected: green.

- [ ] **Step 6: Write the failing types test**

`lib/plaud/mcp/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseToolJson, mapFile, mapFileDetail } from "./types";

describe("parseToolJson", () => {
  it("concatenates text blocks and JSON-parses", () => {
    const result = { content: [{ type: "text", text: '{"files":' }, { type: "text", text: "[]}" }, { type: "image" }] };
    expect(parseToolJson(result)).toEqual({ files: [] });
  });
});

describe("mapFile", () => {
  it("maps documented fields and computes startAtMs", () => {
    const f = mapFile({ id: "f1", name: "Sync", start_at: "2026-06-01T10:00:00Z", duration: 65000 });
    expect(f).toMatchObject({ fileId: "f1", name: "Sync", durationMs: 65000, trashed: false });
    expect(f.startAtMs).toBe(Date.parse("2026-06-01T10:00:00Z"));
  });
  it("tolerates field-name variants and throws on no date", () => {
    expect(mapFile({ file_id: 2, start_time: "2026-06-02T00:00:00Z" }).fileId).toBe("2");
    expect(() => mapFile({ id: "x" })).toThrow(/date/);
  });
});

describe("mapFileDetail", () => {
  it("requires a presigned url", () => {
    expect(mapFileDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/a" }).presignedUrl).toBe("https://signed/a");
    expect(() => mapFileDetail({ id: "f1", start_at: "2026-06-01T10:00:00Z" })).toThrow(/presigned/);
  });
});
```

- [ ] **Step 7: Run test → fails**

Run: `pnpm test lib/plaud/mcp/types.test.ts`
Expected: FAIL (`Cannot find module './types'`).

- [ ] **Step 8: Implement `lib/plaud/mcp/types.ts`**

```ts
export interface PlaudFile {
  fileId: string;
  name: string;
  startAtMs: number; // epoch ms — checkpoint key
  durationMs?: number;
  trashed: boolean;
}
export interface PlaudFileDetail extends PlaudFile {
  presignedUrl: string; // signed, ~24h
}

/** MCP tool results are { content: [{ type:"text", text }, …] }. */
export function parseToolJson<T>(result: any): T {
  const text = (result?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("");
  return JSON.parse(text) as T;
}

// Field names confirmed against the MCP docs (id/name/start_at/duration ms/presigned_url);
// tolerant fallbacks + a loud throw so a wrong field is caught at the live step, not silently.
export function mapFile(raw: any): PlaudFile {
  const startRaw = raw.start_at ?? raw.start_time ?? raw.created_at;
  const startAtMs = typeof startRaw === "number" ? startRaw : Date.parse(startRaw);
  if (Number.isNaN(startAtMs)) throw new Error(`mapFile: no recognizable date field in ${JSON.stringify(raw)}`);
  return {
    fileId: String(raw.id ?? raw.file_id),
    name: raw.name ?? raw.title ?? "Untitled",
    startAtMs,
    durationMs: typeof raw.duration === "number" ? raw.duration : undefined,
    trashed: Boolean(raw.is_trash ?? raw.trashed ?? raw.is_deleted ?? false),
  };
}
export function mapFileDetail(raw: any): PlaudFileDetail {
  const presignedUrl = raw.presigned_url ?? raw.url ?? raw.audio_url;
  if (!presignedUrl) throw new Error(`mapFileDetail: no presigned_url in ${JSON.stringify(raw)}`);
  return { ...mapFile(raw), presignedUrl };
}
```

- [ ] **Step 9: Run tests → pass; typecheck; commit**

Run: `pnpm test lib/plaud/mcp/types.test.ts && pnpm exec tsc --noEmit`
Expected: green + clean.
```bash
git add package.json pnpm-lock.yaml lib/config.ts lib/config.test.ts lib/plaud/mcp/types.ts lib/plaud/mcp/types.test.ts
git commit -m "feat: add MCP SDK, plaud redirect config, and Plaud MCP types/parsing"
```

---

### Task 2: Encrypted OAuth auth-store

**Files:**
- Create: `lib/plaud/mcp/auth-store.ts`, `lib/plaud/mcp/auth-store.test.ts`

**Interfaces:**
- Consumes: `db`, `apiCredentials`, `encryptSecret`/`decryptSecret`, `OAuthClientInformation`/`OAuthTokens` (SDK types).
- Produces: `plaudAuthStore` with `getTokens()/saveTokens(t)`, `getClientInfo()/saveClientInfo(c)`, `getCodeVerifier()/saveCodeVerifier(v)`, `getAuthorizationUrl()/saveAuthorizationUrl(u)`, `isConnected()`, `clear()`. State persisted as ONE AES-encrypted JSON blob in `api_credentials` (`provider='plaud'`).

- [ ] **Step 1: Write the failing test**

`lib/plaud/mcp/auth-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// in-memory api_credentials backing the mocked db
const store: { row?: { provider: string; ciphertext: string } } = {};
vi.mock("@/db", () => ({
  db: {
    query: { apiCredentials: { findFirst: async () => store.row } },
    insert: () => ({ values: (v: any) => ({ onConflictDoUpdate: async ({ set }: any) => { store.row = { provider: v.provider, ciphertext: set.ciphertext }; } }) }),
    delete: () => ({ where: async () => { store.row = undefined; } }),
  },
}));

beforeEach(() => { store.row = undefined; process.env.ENCRYPTION_KEY = "0".repeat(64); });

describe("plaudAuthStore", () => {
  it("round-trips tokens / clientInfo / codeVerifier through encryption", async () => {
    const { plaudAuthStore } = await import("./auth-store");
    await plaudAuthStore.saveTokens({ access_token: "a", token_type: "bearer" } as any);
    await plaudAuthStore.saveClientInfo({ client_id: "c1" } as any);
    await plaudAuthStore.saveCodeVerifier("verifier-123");
    expect(store.row!.ciphertext).not.toContain("verifier-123"); // encrypted at rest
    expect((await plaudAuthStore.getTokens())?.access_token).toBe("a");
    expect((await plaudAuthStore.getClientInfo())?.client_id).toBe("c1");
    expect(await plaudAuthStore.getCodeVerifier()).toBe("verifier-123");
    expect(await plaudAuthStore.isConnected()).toBe(true);
  });
  it("isConnected is false with no tokens; clear() wipes state", async () => {
    const { plaudAuthStore } = await import("./auth-store");
    expect(await plaudAuthStore.isConnected()).toBe(false);
    await plaudAuthStore.saveCodeVerifier("v"); // state exists but no tokens
    expect(await plaudAuthStore.isConnected()).toBe(false);
    await plaudAuthStore.saveTokens({ access_token: "a", token_type: "bearer" } as any);
    expect(await plaudAuthStore.isConnected()).toBe(true);
    await plaudAuthStore.clear();
    expect(await plaudAuthStore.isConnected()).toBe(false);
    expect(store.row).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → fails**

Run: `pnpm test lib/plaud/mcp/auth-store.test.ts`
Expected: FAIL (`Cannot find module './auth-store'`).

- [ ] **Step 3: Implement `lib/plaud/mcp/auth-store.ts`**

```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { encryptSecret, decryptSecret } from "@/lib/crypto/secrets";
import type { OAuthClientInformation, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";

const PROVIDER = "plaud";

interface PlaudOAuthState {
  tokens?: OAuthTokens;
  clientInformation?: OAuthClientInformation;
  codeVerifier?: string;
  authorizationUrl?: string;
}

async function load(): Promise<PlaudOAuthState> {
  const row = await db.query.apiCredentials.findFirst({ where: eq(apiCredentials.provider, PROVIDER) });
  return row ? (JSON.parse(decryptSecret(row.ciphertext)) as PlaudOAuthState) : {};
}

async function save(state: PlaudOAuthState): Promise<void> {
  const ciphertext = encryptSecret(JSON.stringify(state));
  await db
    .insert(apiCredentials)
    .values({ provider: PROVIDER, ciphertext })
    .onConflictDoUpdate({ target: apiCredentials.provider, set: { ciphertext } });
}

export const plaudAuthStore = {
  async getTokens() { return (await load()).tokens; },
  async saveTokens(tokens: OAuthTokens) { const s = await load(); s.tokens = tokens; await save(s); },
  async getClientInfo() { return (await load()).clientInformation; },
  async saveClientInfo(info: OAuthClientInformation) { const s = await load(); s.clientInformation = info; await save(s); },
  async getCodeVerifier() { return (await load()).codeVerifier; },
  async saveCodeVerifier(v: string) { const s = await load(); s.codeVerifier = v; await save(s); },
  async getAuthorizationUrl() { return (await load()).authorizationUrl; },
  async saveAuthorizationUrl(url: string) { const s = await load(); s.authorizationUrl = url; await save(s); },
  async isConnected() { return Boolean((await load()).tokens); },
  async clear() { await db.delete(apiCredentials).where(eq(apiCredentials.provider, PROVIDER)); },
};
```

- [ ] **Step 4: Run test → passes; typecheck; commit**

Run: `pnpm test lib/plaud/mcp/auth-store.test.ts && pnpm exec tsc --noEmit`
```bash
git add lib/plaud/mcp/auth-store.ts lib/plaud/mcp/auth-store.test.ts
git commit -m "feat: add encrypted Plaud OAuth auth-store"
```

---

### Task 3: OAuth provider + MCP client

**Files:**
- Create: `lib/plaud/mcp/oauth-provider.ts`, `lib/plaud/mcp/client.ts`, `lib/plaud/mcp/client.test.ts`

**Interfaces:**
- Consumes: `@modelcontextprotocol/sdk` (`Client`, `StreamableHTTPClientTransport`, `OAuthClientProvider`), `plaudAuthStore`, `config.plaudRedirectUrl`, `mcp/types`.
- Produces: `PlaudOAuthProvider`; and from `client.ts`: `connect(): Promise<Client>`, `finishAuth(code): Promise<void>`, `beginAuth(): Promise<string>` (returns the authorize URL), `isConnected(): Promise<boolean>`, `disconnect(): Promise<void>`, `listFiles(client, args?): Promise<PlaudFile[]>`, `getFile(client, id): Promise<PlaudFileDetail>`, `downloadAudio(url): Promise<{ bytes: Buffer; contentType: string }>`.

- [ ] **Step 1: Implement `lib/plaud/mcp/oauth-provider.ts`**

```ts
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { plaudAuthStore } from "./auth-store";
import { config } from "@/lib/config";

export class PlaudOAuthProvider implements OAuthClientProvider {
  get redirectUrl() { return config.plaudRedirectUrl(); }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Engram",
      redirect_uris: [config.plaudRedirectUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
      scope: "openid", // VERIFY exact scopes at the live Connect step
    };
  }
  async clientInformation() { return plaudAuthStore.getClientInfo(); }
  async saveClientInformation(info: OAuthClientInformation) { await plaudAuthStore.saveClientInfo(info); }
  async tokens() { return plaudAuthStore.getTokens(); }
  async saveTokens(tokens: OAuthTokens) { await plaudAuthStore.saveTokens(tokens); }
  async redirectToAuthorization(url: URL) { await plaudAuthStore.saveAuthorizationUrl(url.toString()); }
  async saveCodeVerifier(v: string) { await plaudAuthStore.saveCodeVerifier(v); }
  async codeVerifier() {
    const v = await plaudAuthStore.getCodeVerifier();
    if (!v) throw new Error("Missing PKCE code_verifier");
    return v;
  }
}
```

- [ ] **Step 2: Write the failing client test (tool mapping via a mock Client)**

`lib/plaud/mcp/client.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { listFiles, getFile } from "./client";

function toolResult(obj: unknown) {
  return { content: [{ type: "text", text: JSON.stringify(obj) }] };
}

describe("listFiles", () => {
  it("calls list_files and maps results", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ files: [{ id: "f1", start_at: "2026-06-01T10:00:00Z" }] })) } as any;
    const files = await listFiles(client, { date_from: "2026-05-01T00:00:00Z" });
    expect(client.callTool).toHaveBeenCalledWith({ name: "list_files", arguments: { date_from: "2026-05-01T00:00:00Z" } });
    expect(files).toHaveLength(1);
    expect(files[0].fileId).toBe("f1");
  });
  it("handles array / data / list response shapes", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ data: [{ id: "a", start_at: "2026-06-01T10:00:00Z" }] })) } as any;
    expect((await listFiles(client)).map((f) => f.fileId)).toEqual(["a"]);
  });
});

describe("getFile", () => {
  it("calls get_file and maps the detail", async () => {
    const client = { callTool: vi.fn(async () => toolResult({ id: "f1", start_at: "2026-06-01T10:00:00Z", presigned_url: "https://signed/f1.mp3" })) } as any;
    const detail = await getFile(client, "f1");
    expect(client.callTool).toHaveBeenCalledWith({ name: "get_file", arguments: { id: "f1" } });
    expect(detail.presignedUrl).toBe("https://signed/f1.mp3");
  });
});
```

- [ ] **Step 3: Run test → fails**

Run: `pnpm test lib/plaud/mcp/client.test.ts`
Expected: FAIL (`Cannot find module './client'`).

- [ ] **Step 4: Implement `lib/plaud/mcp/client.ts`**

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { PlaudOAuthProvider } from "./oauth-provider";
import { plaudAuthStore } from "./auth-store";
import { parseToolJson, mapFile, mapFileDetail, type PlaudFile, type PlaudFileDetail } from "./types";

const PLAUD_MCP_URL = new URL("https://mcp.plaud.ai/mcp");

function newTransport() {
  return new StreamableHTTPClientTransport(PLAUD_MCP_URL, { authProvider: new PlaudOAuthProvider() });
}

/** Connect using stored tokens. Throws (UnauthorizedError) if not authorized / refresh fails. */
export async function connect(): Promise<Client> {
  const client = new Client({ name: "engram", version: "0.1.0" });
  await client.connect(newTransport());
  return client;
}

/** Exchange the OAuth code for tokens (called from the callback route). */
export async function finishAuth(code: string): Promise<void> {
  await newTransport().finishAuth(code);
}

/** Begin OAuth: triggers the SDK to store the authorize URL, which we return for a browser redirect. */
export async function beginAuth(): Promise<string> {
  try {
    await connect(); // no tokens → provider.redirectToAuthorization stores the URL, then connect throws
  } catch {
    // expected on first connect without tokens
  }
  const url = await plaudAuthStore.getAuthorizationUrl();
  if (!url) throw new Error("Failed to obtain Plaud authorization URL");
  return url;
}

export async function isConnected(): Promise<boolean> {
  return plaudAuthStore.isConnected();
}

export async function disconnect(): Promise<void> {
  await plaudAuthStore.clear();
}

export async function listFiles(
  client: Client,
  args: { query?: string; date_from?: string; date_to?: string; page?: number; page_size?: number } = {},
): Promise<PlaudFile[]> {
  const res = await client.callTool({ name: "list_files", arguments: args });
  const parsed = parseToolJson<any>(res);
  const items = Array.isArray(parsed) ? parsed : (parsed.files ?? parsed.data ?? parsed.list ?? parsed.items ?? []);
  const out: PlaudFile[] = [];
  let firstError: unknown;
  for (const raw of items) {
    try { out.push(mapFile(raw)); }
    catch (e) { if (firstError === undefined) firstError = e; }
  }
  if (items.length > 0 && out.length === 0) {
    throw firstError instanceof Error ? firstError : new Error("listFiles: no files could be mapped");
  }
  return out;
}

export async function getFile(client: Client, id: string): Promise<PlaudFileDetail> {
  const res = await client.callTool({ name: "get_file", arguments: { id } });
  const parsed = parseToolJson<any>(res);
  return mapFileDetail(parsed.data ?? parsed.file ?? parsed);
}

export async function downloadAudio(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url); // presigned — no auth header
  if (!res.ok) throw new Error(`audio download failed: ${res.status}`);
  return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "audio/mpeg" };
}
```

- [ ] **Step 5: Run test → passes; typecheck; commit**

Run: `pnpm test lib/plaud/mcp/client.test.ts && pnpm exec tsc --noEmit`
Expected: green + clean. (If the SDK's `.js` subpath type imports trip `tsc`, confirm `@modelcontextprotocol/sdk` is installed and its `exports` map resolves under `moduleResolution: bundler` — do NOT change the import paths, which match the SDK's published entrypoints.)
```bash
git add lib/plaud/mcp/oauth-provider.ts lib/plaud/mcp/client.ts lib/plaud/mcp/client.test.ts
git commit -m "feat: add Plaud OAuth provider and MCP-SDK client"
```

---

### Task 4: Swap `sync.ts` to the MCP client; remove the REST client

**Files:**
- Modify: `lib/plaud/sync.ts`, `lib/plaud/sync.test.ts`, `lib/config.ts`, `lib/config.test.ts`
- Delete: `lib/plaud/client.ts`, `lib/plaud/client.test.ts`

**Interfaces:**
- Consumes: `mcp/client` (`isConnected`/`connect`/`listFiles`/`getFile`/`downloadAudio`), `mcp/types` (`PlaudFile`). `selectNewRecordings` now takes `PlaudFile[]` (same fields it already used: `fileId`/`startAtMs`/`trashed`).
- Produces: unchanged `syncPlaud(): Promise<SyncResult>` and `selectNewRecordings(all, checkpointMs, existingFileIds)`.

- [ ] **Step 1: Rewrite the top of `lib/plaud/sync.ts`**

Replace the imports and `selectNewRecordings` signature:
```ts
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings, syncState } from "@/db/schema";
import { getStorage, buildAudioKey } from "@/lib/storage";
import { runTranscription, runEnhancement } from "@/lib/pipeline";
import { isConnected, connect, listFiles, getFile, downloadAudio } from "./mcp/client";
import type { PlaudFile } from "./mcp/types";

export interface SyncResult {
  ranAt: string;
  newCount: number;
  skippedCount: number;
  failedCount: number;
  error?: string;
}

export function selectNewRecordings(
  all: PlaudFile[],
  checkpointMs: number,
  existingFileIds: Set<string>,
): PlaudFile[] {
  return all
    .filter((r) => !r.trashed)
    .filter((r) => r.startAtMs > checkpointMs)
    .filter((r) => !existingFileIds.has(r.fileId))
    .sort((a, b) => a.startAtMs - b.startAtMs);
}
```
(Keep `extFromContentType`, `getSyncRow`, `writeResult` as-is.)

- [ ] **Step 2: Rewrite the `syncPlaud` body to drive the MCP client**

Replace the `syncPlaud` function with (the per-item loop + checkpoint math are UNCHANGED — only the data source and connection lifecycle change):
```ts
export async function syncPlaud(): Promise<SyncResult> {
  const ranAt = new Date().toISOString();
  const base: SyncResult = { ranAt, newCount: 0, skippedCount: 0, failedCount: 0 };

  const row = await getSyncRow();

  if (!(await isConnected())) {
    const result = { ...base, error: "not connected — connect Plaud in Settings" };
    await writeResult(row.id, result);
    return result;
  }

  const checkpointMs = row.lastSyncedAt ? new Date(row.lastSyncedAt).getTime() : 0;

  let client;
  try {
    client = await connect();
  } catch {
    const result = { ...base, error: "reconnect needed — Plaud authorization expired" };
    await writeResult(row.id, result); // checkpoint not advanced
    return result;
  }

  try {
    let all: PlaudFile[];
    try {
      const dateFrom = row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : undefined;
      all = await listFiles(client, dateFrom ? { date_from: dateFrom } : {});
    } catch (e) {
      const result = { ...base, error: (e as Error).message };
      await writeResult(row.id, result); // checkpoint not advanced
      return result;
    }

    const existing = await db.query.recordings.findMany();
    const existingFileIds = new Set(existing.map((r: any) => r.plaudFileId).filter(Boolean) as string[]);

    const candidates = selectNewRecordings(all, checkpointMs, existingFileIds);
    const skippedCount = all.length - candidates.length;

    let newCount = 0;
    let failedCount = 0;
    let maxSuccessMs = checkpointMs;
    let earliestFailureMs = Infinity;

    for (const r of candidates) {
      let insertedId: string | undefined;
      try {
        const detail = await getFile(client, r.fileId);
        const { bytes, contentType } = await downloadAudio(detail.presignedUrl);
        const [rec] = await db
          .insert(recordings)
          .values({
            title: r.name,
            source: "plaud",
            storageKey: "pending",
            contentType,
            durationSeconds: r.durationMs ? Math.round(r.durationMs / 1000) : null,
            plaudFileId: r.fileId,
          })
          .returning();
        insertedId = rec.id;
        const key = buildAudioKey(rec.id, `x.${extFromContentType(contentType)}`);
        await getStorage().put(key, bytes, contentType);
        await db.update(recordings).set({ storageKey: key }).where(eq(recordings.id, rec.id));

        await runTranscription(rec.id);
        const stored = await db.query.recordings.findFirst({ where: eq(recordings.id, rec.id) });
        if (stored?.status === "transcribed") await runEnhancement(rec.id);

        newCount++;
        if (r.startAtMs > maxSuccessMs) maxSuccessMs = r.startAtMs;
      } catch {
        failedCount++;
        earliestFailureMs = Math.min(earliestFailureMs, r.startAtMs);
        if (insertedId) {
          try { await db.delete(recordings).where(eq(recordings.id, insertedId)); } catch {}
        }
      }
    }

    const newCheckpointMs =
      earliestFailureMs === Infinity ? maxSuccessMs : Math.max(checkpointMs, earliestFailureMs - 1);
    const result: SyncResult = { ranAt, newCount, skippedCount, failedCount };
    await db.update(syncState).set({ lastSyncedAt: new Date(newCheckpointMs), lastResult: result }).where(eq(syncState.id, row.id));
    return result;
  } finally {
    await client.close();
  }
}
```

- [ ] **Step 3: Rewrite `lib/plaud/sync.test.ts` to mock `./mcp/client`**

Replace the `vi.mock("./client", …)` and `vi.mock("./credentials", …)` blocks with a mock of `./mcp/client`. Keep ALL existing assertions (ingest+checkpoint-advance, skip trashed+dup, PlaudAuth→reconnect, checkpoint-past-failure, negative-enhancement-guard). The mock surface:
```ts
const calls: any = {};
vi.mock("./mcp/client", () => ({
  isConnected: vi.fn(async () => calls.connected ?? true),
  connect: vi.fn(async () => { if (calls.connectThrows) throw new Error("UnauthorizedError"); return { close: vi.fn(async () => {}) }; }),
  listFiles: vi.fn(async () => calls.files ?? []),
  getFile: vi.fn(async (_c: any, id: string) => ({ fileId: id, name: id, startAtMs: 0, trashed: false, presignedUrl: `https://signed/${id}` })),
  downloadAudio: vi.fn(async (url: string) => { if (calls.failUrl === url) throw new Error("download failed"); return { bytes: Buffer.from("x"), contentType: "audio/mpeg" }; }),
}));
```
Then in tests, set `calls.files = [...]` (PlaudFile objects), drive the same scenarios, and:
- the prior "PlaudAuthError → reconnect" test becomes "`calls.connectThrows = true` → result.error matches /reconnect/ and checkpoint not advanced".
- the "not connected" path: `calls.connected = false` → error /not connected/.
Keep the `@/db`, `@/lib/storage`, `@/lib/pipeline` mocks as they are (they already exist in this test file), adding `calls.deleted`/`findFirstResult` handling already present. Update `beforeEach` to reset `calls.connected=true`, `calls.connectThrows=false`, `calls.files=[]`, `calls.failUrl=undefined`.

- [ ] **Step 4: Delete the REST client + remove `plaudApiBase`**

```bash
git rm lib/plaud/client.ts lib/plaud/client.test.ts
```
In `lib/config.ts` remove the `plaudApiBase` line. In `lib/config.test.ts` remove the `plaudApiBase` describe block (keep `plaudRedirectUrl`). Confirm nothing else imports `@/lib/plaud/client` or `config.plaudApiBase`:
```bash
grep -rn "plaud/client\"\|plaudApiBase" lib app || echo "clean"
```

- [ ] **Step 5: Run sync tests + full suite + typecheck → green; commit**

Run: `pnpm test lib/plaud/sync.test.ts && pnpm exec tsc --noEmit && pnpm test`
Expected: green + clean. (`credentials.ts` still exists here — it's removed in Task 5 with the token route. `sync.ts` no longer imports it.)
```bash
git add lib/plaud/sync.ts lib/plaud/sync.test.ts lib/config.ts lib/config.test.ts
git commit -m "feat: drive Plaud sync via the official MCP client; remove REST client"
```

---

### Task 5: OAuth routes + Settings rewire; remove pasted-token route/store

**Files:**
- Create: `app/api/plaud/connect/route.ts`, `app/api/plaud/callback/route.ts`, `app/api/plaud/disconnect/route.ts`
- Modify: `app/settings/page.tsx`, `app/settings/plaud-settings.tsx`
- Delete: `app/api/plaud/token/route.ts`, `lib/plaud/credentials.ts`

**Interfaces:**
- Consumes: `auth`, `mcp/client` (`beginAuth`/`finishAuth`/`disconnect`/`isConnected`), `requireSession`, `db`/`syncState`.

- [ ] **Step 1: Read the Next.js 16 route-handler + redirect docs**

Run: `ls node_modules/next/dist/docs/` and confirm `NextResponse.redirect`, dynamic `searchParams` on pages (Promise), and that `request.nextUrl.searchParams` is available in route handlers.

- [ ] **Step 2: `app/api/plaud/connect/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { beginAuth } from "@/lib/plaud/mcp/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  try {
    const url = await beginAuth();
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  }
}
```

- [ ] **Step 3: `app/api/plaud/callback/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { finishAuth } from "@/lib/plaud/mcp/client";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.redirect(new URL("/login", request.url));
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  try {
    await finishAuth(code);
    return NextResponse.redirect(new URL("/settings?plaud=connected", request.url));
  } catch {
    return NextResponse.redirect(new URL("/settings?plaud=error", request.url));
  }
}
```

- [ ] **Step 4: `app/api/plaud/disconnect/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnect } from "@/lib/plaud/mcp/client";

export async function POST(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await disconnect();
  return NextResponse.json({ connected: false });
}
```

- [ ] **Step 5: Rewrite `app/settings/page.tsx`**

```tsx
import { requireSession } from "@/lib/auth-guard";
import { db } from "@/db";
import { PlaudSettings } from "./plaud-settings";
import { isConnected } from "@/lib/plaud/mcp/client";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ plaud?: string }> }) {
  await requireSession();
  const { plaud } = await searchParams;
  const connected = await isConnected();
  const sync = await db.query.syncState.findFirst();
  return (
    <section className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Instellingen</h1>
      <PlaudSettings connected={connected} lastResult={sync?.lastResult ?? null} oauthStatus={plaud ?? null} />
    </section>
  );
}
```

- [ ] **Step 6: Rewrite `app/settings/plaud-settings.tsx`** (Connect/Disconnect instead of paste-token)

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type LastResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string } | null;

export function PlaudSettings({ connected, lastResult, oauthStatus }: { connected: boolean; lastResult: LastResult; oauthStatus: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(
    oauthStatus === "connected" ? "Plaud verbonden." : oauthStatus === "error" ? "Verbinden met Plaud mislukt." : null,
  );
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/plaud/disconnect", { method: "POST" });
      setStatus("Verbinding verbroken.");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setStatus("Bezig met synchroniseren…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync mislukt");
      setStatus(json.error ? `Sync: ${json.error}` : `Sync klaar — ${json.newCount} nieuw, ${json.skippedCount} overgeslagen, ${json.failedCount} mislukt.`);
      router.refresh();
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-medium">Plaud-koppeling</h2>
        <p className="text-sm text-muted-foreground">Status: {connected ? "verbonden" : "niet verbonden"}.</p>
        {connected ? (
          <Button variant="outline" onClick={disconnect} disabled={busy}>Verbinding verbreken</Button>
        ) : (
          <Button asChild><a href="/api/plaud/connect">Verbind met Plaud</a></Button>
        )}
      </div>

      <div className="space-y-2">
        <Button onClick={syncNow} disabled={busy || !connected}>Nu synchroniseren</Button>
        {lastResult && (
          <p className="text-sm text-muted-foreground">
            Laatste sync: {new Date(lastResult.ranAt).toLocaleString("nl-BE")} — {lastResult.error ?? `${lastResult.newCount} nieuw, ${lastResult.skippedCount} overgeslagen, ${lastResult.failedCount} mislukt`}
          </p>
        )}
      </div>

      {status && <p className="text-sm">{status}</p>}
    </section>
  );
}
```
(`Button asChild` is shadcn's Radix-Slot pattern; confirm `components/ui/button.tsx` exports it — it does in the default shadcn button. The Connect control MUST be an `<a href>` so the browser navigates top-level to the OAuth redirect.)

- [ ] **Step 7: Delete the pasted-token route + store**

```bash
git rm app/api/plaud/token/route.ts lib/plaud/credentials.ts
grep -rn "plaud/credentials\"\|/api/plaud/token" app lib || echo "clean"
```

- [ ] **Step 8: Typecheck + full suite → green; commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
Expected: clean + green (the `app/api/sync/auth.test.ts` still passes — that route is unchanged).
```bash
git add app/api/plaud app/settings
git commit -m "feat: add Plaud OAuth connect/callback/disconnect routes and rewire Settings"
```

---

### Task 6: Env + docs

**Files:**
- Modify: `.env.example`, `DEPLOY.md`, `PROGRESS.md`

**Interfaces:** none (docs/config).

- [ ] **Step 1: `.env.example`** — remove `PLAUD_API_BASE` (no longer used). Add a comment under the existing `NEXT_PUBLIC_APP_URL` noting it also forms the Plaud OAuth redirect URI (`<NEXT_PUBLIC_APP_URL>/api/plaud/callback`). `CRON_SECRET` stays (cron path unchanged).

- [ ] **Step 2: `DEPLOY.md`** — replace the Phase-1 "paste session token" instructions with the **official MCP OAuth** flow: in Engram → Instellingen, click **"Verbind met Plaud"** → authorize in the Plaud window → you're redirected back connected. Note the redirect URI is `<NEXT_PUBLIC_APP_URL>/api/plaud/callback` (must match what Plaud's OAuth allows; dynamic client registration handles this automatically, with a manual client-registration fallback if needed). Keep the `CRON_SECRET` + cron-schedule steps. Remove any `PLAUD_API_BASE` mention.

- [ ] **Step 3: `PROGRESS.md`** — note the pivot back to the official MCP (link this plan + the MCP spec); check off the MCP auth + client + sync items; leave the live OAuth handshake + first real sync as the pending human/live-verify step.

- [ ] **Step 4: Typecheck + suite (unchanged) + commit**

Run: `pnpm exec tsc --noEmit && pnpm test`
```bash
git add .env.example DEPLOY.md PROGRESS.md
git commit -m "chore: document Plaud MCP OAuth setup; drop PLAUD_API_BASE"
```

---

## Live verification (during execution, after Task 6 — the user is connected with a recording)

Not a code task; the human-in-the-loop validation that this build enables:
1. Deploy; in Settings click **Verbind met Plaud** → complete the OAuth authorize → confirm it returns `?plaud=connected` and status shows "verbonden". (Resolves the DCR-vs-manual-client unknown.)
2. Click **Nu synchroniseren** → confirm `list_files`→`get_file`→download→transcribe→summary end-to-end on the real recording.
3. If `list_files`/`get_file` field names differ from the documented ones, adjust `lib/plaud/mcp/types.ts` mappers (one file) and confirm `duration` unit (ms assumed).

## Self-Review

**Spec coverage:** MCP transport/SDK → Tasks 1,3. Interactive OAuth (connect/callback) → Task 5. Encrypted OAuth blob in `api_credentials` → Task 2. MCP client (list_files/get_file/download) → Task 3. Adapted sync reusing durability → Task 4. Settings Connect/Disconnect → Task 5. Remove RE layer (client, credentials, token route, plaudApiBase, paste UI) → Tasks 4,5. No new migration → reuse (Tasks 2,4). Env/docs → Task 6. Live verify → final section. All spec sections covered.

**Placeholder scan:** No "TODO/handle errors" instructions. The OAuth `scope` and DCR-vs-manual are flagged as live-verify points with concrete defaults (not vague placeholders); tool-mapping field fallbacks are deliberate + tested.

**Type consistency:** `PlaudFile`/`PlaudFileDetail` defined in `mcp/types.ts` (Task 1), consumed by `client.ts` (Task 3) and `sync.ts` (Task 4) — `selectNewRecordings` uses the same `fileId`/`startAtMs`/`trashed` fields it already used. `plaudAuthStore` method names consistent across Tasks 2/3. `parseToolJson`/`mapFile`/`mapFileDetail` consistent (Tasks 1/3). `connect`/`finishAuth`/`beginAuth`/`isConnected`/`disconnect`/`listFiles`/`getFile`/`downloadAudio` names consistent across Tasks 3/4/5. `config.plaudRedirectUrl` (Task 1) used by `oauth-provider` (Task 3). `SyncResult` shape unchanged (matches `sync_state.lastResult` `$type` + Settings `LastResult`). Recordings insert uses real columns. Pipeline reuse matches the transcribe→`status==='transcribed'`→enhance pattern.
