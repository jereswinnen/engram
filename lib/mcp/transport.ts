import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { randomUUID } from "node:crypto"
import type { AuthPrincipal } from "@/lib/auth/principal"
import { isAuthFailure } from "@/lib/auth/policy"
import { requireMcpPrincipal } from "./auth"
import { mcpEnabled, mcpUnavailableResponse } from "./feature"
import { MCP_MAX_REQUEST_BYTES } from "./limits"
import { createEngramMcpServer, type McpServerDependencies } from "./server"

type TransportDependencies = {
  env?: Record<string, string | undefined>
  authenticate?: (request: Request) => Promise<AuthPrincipal | Response>
  server?: McpServerDependencies
}

function jsonRpcError(status: number, code: number, message: string): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status }
  )
}

async function boundedPostRequest(
  request: Request
): Promise<Request | Response> {
  if (!request.body) return request
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > MCP_MAX_REQUEST_BYTES) {
      await reader.cancel()
      return jsonRpcError(413, -32000, "Request body is too large.")
    }
    chunks.push(value)
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: body.buffer,
  })
}

export async function handleMcpHttpRequest(
  request: Request,
  dependencies: TransportDependencies = {}
): Promise<Response> {
  const env = dependencies.env ?? process.env
  if (!mcpEnabled(env)) return mcpUnavailableResponse()

  const authenticate = dependencies.authenticate ?? requireMcpPrincipal
  const principal = await authenticate(request)
  if (isAuthFailure(principal)) return principal

  const contentLength = request.headers.get("content-length")
  if (
    contentLength !== null &&
    Number.isFinite(Number(contentLength)) &&
    Number(contentLength) > MCP_MAX_REQUEST_BYTES
  ) {
    return jsonRpcError(413, -32000, "Request body is too large.")
  }

  if (request.method !== "POST") {
    return jsonRpcError(405, -32000, "Method not allowed.")
  }

  const boundedRequest = await boundedPostRequest(request)
  if (boundedRequest instanceof Response) return boundedRequest

  const appUrl = (
    env.BETTER_AUTH_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin
  ).replace(/\/+$/, "")
  const requestId = randomUUID()
  const server = createEngramMcpServer(
    { principal, appUrl, requestId },
    dependencies.server
  )
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(boundedRequest)
  } catch {
    console.error(JSON.stringify({ event: "mcp_transport_error", requestId }))
    return jsonRpcError(500, -32603, "Internal MCP server error.")
  } finally {
    await server.close().catch(() => undefined)
  }
}
