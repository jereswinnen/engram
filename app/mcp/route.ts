import { handleMcpHttpRequest } from "@/lib/mcp/transport"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request)
}

export async function GET(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request)
}

export async function DELETE(request: Request): Promise<Response> {
  return handleMcpHttpRequest(request)
}
