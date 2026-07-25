import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { PlaudOAuthProvider } from "./oauth-provider"
import {
  consumePlaudOAuthAttempt,
  createPlaudAuthStore,
  createPlaudOAuthAttempt,
} from "./auth-store"
import {
  parseToolJson,
  mapFile,
  mapFileDetail,
  type PlaudFile,
  type PlaudFileDetail,
} from "./types"

const PLAUD_MCP_URL = new URL("https://mcp.plaud.ai/mcp")

function newTransport(ownerId: string, attemptId?: string, state?: string) {
  return new StreamableHTTPClientTransport(PLAUD_MCP_URL, {
    authProvider: new PlaudOAuthProvider(ownerId, attemptId, state),
  })
}

/** Connect using stored tokens. Throws (UnauthorizedError) if not authorized / refresh fails. */
export async function connect(ownerId: string): Promise<Client> {
  const client = new Client({ name: "engram", version: "0.1.0" })
  await client.connect(newTransport(ownerId))
  return client
}

/** Exchange the OAuth code for tokens (called from the callback route). */
export async function finishAuth(
  ownerId: string,
  code: string,
  state: string
): Promise<void> {
  const attempt = await consumePlaudOAuthAttempt(ownerId, state)
  if (!attempt) throw new Error("Invalid or expired Plaud OAuth state")
  await newTransport(ownerId, attempt.id).finishAuth(code)
}

/** Begin OAuth: triggers the SDK to store the authorize URL, which we return for a browser redirect. */
export async function beginAuth(ownerId: string): Promise<string> {
  const { attemptId, state } = await createPlaudOAuthAttempt(ownerId)
  const store = createPlaudAuthStore(ownerId, attemptId)
  let connectError: unknown
  try {
    const client = new Client({ name: "engram", version: "0.1.0" })
    await client.connect(newTransport(ownerId, attemptId, state))
    await client.close()
  } catch (e) {
    connectError = e
  }
  const url = await store.getAuthorizationUrl()
  if (!url)
    throw connectError ?? new Error("Failed to obtain Plaud authorization URL")
  return url
}

export async function isConnected(ownerId: string): Promise<boolean> {
  return createPlaudAuthStore(ownerId).isConnected()
}

export async function disconnect(ownerId: string): Promise<void> {
  await createPlaudAuthStore(ownerId).clear()
}

export async function listFiles(
  client: Client,
  args: {
    query?: string
    date_from?: string
    date_to?: string
    page_size?: number
  } = {}
): Promise<PlaudFile[]> {
  const page_size = args.page_size ?? 50
  const out: PlaudFile[] = []
  let rawCount = 0
  let firstError: unknown
  for (let page = 1; page <= 1000; page++) {
    // 1000-page safety cap
    const res = await client.callTool({
      name: "list_files",
      arguments: { ...args, page, page_size },
    })
    const parsed = parseToolJson<any>(res)
    const items = Array.isArray(parsed)
      ? parsed
      : (parsed.files ?? parsed.data ?? parsed.list ?? parsed.items ?? [])
    rawCount += items.length
    for (const raw of items) {
      try {
        out.push(mapFile(raw))
      } catch (e) {
        if (firstError === undefined) firstError = e
        console.warn(
          `listFiles: skipping unmappable record: ${(e as Error).message}`
        )
      }
    }
    if (items.length < page_size) break // last page
  }
  if (rawCount > 0 && out.length === 0) {
    throw firstError instanceof Error
      ? firstError
      : new Error("listFiles: no files could be mapped")
  }
  return out
}

export async function getFile(
  client: Client,
  id: string
): Promise<PlaudFileDetail> {
  const res = await client.callTool({
    name: "get_file",
    arguments: { file_id: id },
  })
  const parsed = parseToolJson<any>(res)
  const raw = parsed.data ?? parsed.file ?? parsed
  const detail = mapFileDetail(raw)
  if (!detail.presignedUrl && raw && typeof raw === "object") {
    // Diagnostic for recordings stuck "waiting for audio": dump the response's
    // top-level keys (not values — they may hold tokens) so we can tell a genuine
    // not-ready-yet from the audio URL arriving under a field mapFileDetail doesn't
    // recognize (we look for presigned_url / url / audio_url).
    console.warn(
      `[plaud getFile] no audio URL for ${id}; response keys: [${Object.keys(raw).join(", ")}]`
    )
  }
  return detail
}

export async function downloadAudio(
  url: string
): Promise<{ bytes: Buffer; contentType: string }> {
  const res = await fetch(url) // presigned — no auth header
  if (!res.ok) throw new Error(`audio download failed: ${res.status}`)
  return {
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  }
}
