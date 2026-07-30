export function mcpEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.MCP_ENABLED === "true"
}

export function mcpUnavailableResponse(): Response {
  return Response.json({ error: "not_found" }, { status: 404 })
}
