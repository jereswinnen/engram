import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
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

  const appUrl = (
    env.BETTER_AUTH_URL ??
    env.NEXT_PUBLIC_APP_URL ??
    new URL(request.url).origin
  ).replace(/\/+$/, "")
  const server = createEngramMcpServer(
    { principal, appUrl },
    dependencies.server
  )
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })

  try {
    await server.connect(transport)
    return await transport.handleRequest(request)
  } catch {
    return jsonRpcError(500, -32603, "Internal MCP server error.")
  } finally {
    await server.close().catch(() => undefined)
  }
}
