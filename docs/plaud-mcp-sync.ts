/**
 * Plaud MCP sync client for Engram
 * Suggested location: src/lib/plaud/  (split into oauth.ts / client.ts / sync.ts
 * if you prefer; kept in one module here for review).
 *
 * Talks to Plaud's OFFICIAL MCP server (mcp.plaud.ai) via the MCP TypeScript
 * SDK — documented tools only (list_files, get_file, get_transcript), no
 * reverse-engineering.
 *
 * Install: npm i @modelcontextprotocol/sdk
 *
 * ⚠️ VERIFY-marked items are based on Plaud's MCP docs at time of writing.
 * Confirm exact tool argument names, the get_file response field names, the
 * OAuth scope, and the transport type with `client.listTools()` + a real call
 * once your account is authorized. Auth + schemas are where this gets finicky.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

const PLAUD_MCP_URL = new URL("https://mcp.plaud.ai/mcp"); // VERIFY exact path

// ---------------------------------------------------------------------------
// 1. OAuth provider — persists tokens so the headless worker can reconnect.
//    Back PlaudAuthStore with Drizzle (api_credentials table). ENCRYPT tokens
//    at rest (AES-256-GCM) before saving.
// ---------------------------------------------------------------------------

export interface PlaudAuthStore {
  getTokens(): Promise<OAuthTokens | undefined>;
  saveTokens(t: OAuthTokens): Promise<void>;
  getClientInfo(): Promise<OAuthClientInformation | undefined>;
  saveClientInfo(c: OAuthClientInformation): Promise<void>;
  getCodeVerifier(): Promise<string | undefined>;
  saveCodeVerifier(v: string): Promise<void>;
  /** Persist the authorization URL so a route/CLI can send you there once. */
  saveAuthorizationUrl?(url: string): Promise<void>;
}

export class PlaudOAuthProvider implements OAuthClientProvider {
  constructor(
    private store: PlaudAuthStore,
    private readonly _redirectUrl: string, // e.g. https://engram.app/api/plaud/callback
  ) {}

  get redirectUrl() {
    return this._redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Engram",
      redirect_uris: [this._redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
      scope: "openid", // VERIFY: Plaud may require specific scopes
    };
  }

  async clientInformation() {
    return this.store.getClientInfo();
  }
  async saveClientInformation(info: OAuthClientInformation) {
    await this.store.saveClientInfo(info);
  }

  async tokens() {
    return this.store.getTokens();
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.store.saveTokens(tokens);
  }

  async redirectToAuthorization(url: URL) {
    // Headless: no browser to pop. Persist the URL; a route or CLI sends you
    // there once. After approval Plaud redirects to redirectUrl with ?code=...
    await this.store.saveAuthorizationUrl?.(url.toString());
  }

  async saveCodeVerifier(v: string) {
    await this.store.saveCodeVerifier(v);
  }
  async codeVerifier() {
    const v = await this.store.getCodeVerifier();
    if (!v) throw new Error("Missing PKCE code_verifier");
    return v;
  }
}

// ---------------------------------------------------------------------------
// 2. Connection + typed tool helpers
// ---------------------------------------------------------------------------

export interface PlaudFile {
  id: string;
  name?: string;
  created_at?: string;
  start_at?: string;
  duration?: number;
  serial_number?: string;
}

export interface PlaudFileDetail extends PlaudFile {
  presigned_url: string; // 24h temporary audio URL  // VERIFY field name
  // Plaud's own transcript segments — we transcribe with Scribe instead, but
  // available via get_file / get_transcript if you ever want them.
  source_list?: unknown;
  note_list?: unknown;
}

/** MCP tool results = { content: [{ type:"text", text:"..." }, ...] }. */
function parseToolJson<T>(result: any): T {
  const text = (result?.content ?? [])
    .filter((b: any) => b?.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return JSON.parse(text) as T;
}

export async function connectPlaud(provider: PlaudOAuthProvider): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(PLAUD_MCP_URL, {
    authProvider: provider,
  });
  const client = new Client({ name: "engram", version: "0.1.0" });
  await client.connect(transport); // first run without tokens throws UnauthorizedError
  return client;
}

/** Call from /api/plaud/callback to finish the one-time OAuth. */
export async function finishPlaudAuth(provider: PlaudOAuthProvider, code: string) {
  const transport = new StreamableHTTPClientTransport(PLAUD_MCP_URL, {
    authProvider: provider,
  });
  await transport.finishAuth(code); // exchanges code -> tokens, saved via provider
}

export async function listFiles(
  client: Client,
  args: {
    query?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    cursor?: string;
  } = {},
): Promise<{ files: PlaudFile[]; next_cursor?: string }> {
  const res = await client.callTool({ name: "list_files", arguments: args }); // VERIFY arg names
  return parseToolJson(res);
}

export async function getFile(client: Client, id: string): Promise<PlaudFileDetail> {
  const res = await client.callTool({ name: "get_file", arguments: { id } });
  return parseToolJson(res);
}

// ---------------------------------------------------------------------------
// 3. Sync loop — list new files, download audio, store, hand off to Scribe
// ---------------------------------------------------------------------------

export interface SyncDeps {
  getCursor(): Promise<string | undefined>;
  saveCursor(c: string): Promise<void>;
  alreadyHave(plaudFileId: string): Promise<boolean>;
  /** Persist bytes to your storage layer; return the stored path/key. */
  storeAudio(plaudFileId: string, bytes: ArrayBuffer, meta: PlaudFile): Promise<string>;
  /** Hand the stored audio to the Scribe adapter (pass a presigned URL if on R2/S3). */
  transcribe(storagePathOrUrl: string, meta: PlaudFile): Promise<void>;
}

export async function syncPlaud(
  provider: PlaudOAuthProvider,
  deps: SyncDeps,
): Promise<number> {
  const client = await connectPlaud(provider);
  let cursor = await deps.getCursor();
  let synced = 0;

  try {
    while (true) {
      const { files, next_cursor } = await listFiles(client, { cursor, limit: 50 });

      for (const f of files) {
        if (await deps.alreadyHave(f.id)) continue;
        const detail = await getFile(client, f.id);
        const bytes = await fetch(detail.presigned_url).then((r) => {
          if (!r.ok) throw new Error(`audio download failed: ${r.status}`);
          return r.arrayBuffer();
        });
        const path = await deps.storeAudio(f.id, bytes, f);
        await deps.transcribe(path, f);
        synced++;
      }

      if (!next_cursor || next_cursor === cursor) break;
      cursor = next_cursor;
      await deps.saveCursor(cursor);
    }
  } finally {
    await client.close();
  }

  return synced;
}

/* ---------------------------------------------------------------------------
WIRING NOTES

One-time authorization (do once, then it refreshes itself):
  1. Trigger connectPlaud() once — it has no tokens, so the provider stores the
     authorization URL (redirectToAuthorization). Read it from your store and
     open it in a browser; approve.
  2. Plaud redirects to /api/plaud/callback?code=... — that route calls
     finishPlaudAuth(provider, code), which exchanges the code for tokens and
     saves them. From here the worker reconnects headlessly and auto-refreshes.

Scheduled sync:
  - Run syncPlaud() on a schedule from a PERSISTENT Railway worker (or an
    /api/cron/sync route triggered by Railway cron) — NOT a Vercel serverless
    function, which would time out on longer syncs.

Stores (back with Drizzle):
  - PlaudAuthStore  -> api_credentials (encrypt tokens at rest, AES-256-GCM).
  - SyncDeps cursor -> sync_state.last_cursor.
  - alreadyHave     -> SELECT on recordings by plaud_file_id.
  - storeAudio      -> lib/storage (local volume or R2/S3).
  - transcribe      -> the Scribe adapter. If you stored to R2/S3, generate a
    presigned GET and pass it as cloud_storage_url (no second byte transfer);
    otherwise read the file back as a Blob.

If the MCP server speaks SSE rather than streamable HTTP, swap
StreamableHTTPClientTransport for SSEClientTransport (same authProvider option).
If dynamic client registration isn't supported, register a client app with
Plaud manually and seed it via store.saveClientInfo().
--------------------------------------------------------------------------- */
