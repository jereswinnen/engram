export function oauthEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.AUTH_OAUTH_BEARER_ENABLED === "true"
}

export function oauthUnavailableResponse(): Response {
  return Response.json({ error: "not_found" }, { status: 404 })
}
