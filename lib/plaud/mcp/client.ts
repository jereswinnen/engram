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
  await plaudAuthStore.saveAuthorizationUrl(""); // clear any stale URL — only return one freshly produced by this attempt
  let connectError: unknown;
  try {
    await connect(); // no tokens → provider.redirectToAuthorization stores a fresh URL, then connect throws
  } catch (e) {
    connectError = e;
  }
  const url = await plaudAuthStore.getAuthorizationUrl();
  if (!url) throw connectError ?? new Error("Failed to obtain Plaud authorization URL");
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
