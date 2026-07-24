import type { AuthPrincipal } from "./principal"
import { authenticateRequest } from "./principal"

export type AuthPolicy = {
  scopes?: readonly string[]
  audience?: string
  mechanisms?: readonly AuthPrincipal["mechanism"][]
  resourceMetadataUrl?: string
}

function bearerChallenge(
  policy: AuthPolicy,
  error?: "invalid_token" | "insufficient_scope"
) {
  const parts = ["Bearer"]
  if (policy.resourceMetadataUrl) {
    parts.push(`resource_metadata="${policy.resourceMetadataUrl}"`)
  }
  if (error) parts.push(`error="${error}"`)
  if (error === "insufficient_scope" && policy.scopes?.length) {
    parts.push(`scope="${policy.scopes.join(" ")}"`)
  }
  return parts.join(" ")
}

export function unauthorizedResponse(policy: AuthPolicy = {}) {
  return Response.json(
    { error: "unauthorized" },
    {
      status: 401,
      headers: { "WWW-Authenticate": bearerChallenge(policy, "invalid_token") },
    }
  )
}

export function forbiddenResponse(policy: AuthPolicy) {
  return Response.json(
    { error: "insufficient_scope" },
    {
      status: 403,
      headers: {
        "WWW-Authenticate": bearerChallenge(policy, "insufficient_scope"),
      },
    }
  )
}

export function hasScopes(
  principal: AuthPrincipal,
  scopes: readonly string[]
): boolean {
  return scopes.every((scope) => principal.scopes.has(scope))
}

export async function requirePrincipal(
  request: Request,
  policy: AuthPolicy = {}
): Promise<AuthPrincipal | Response> {
  const principal = await authenticateRequest(request)
  if (!principal) return unauthorizedResponse(policy)
  if (principal.connectionId) {
    const { ensureActivePrincipalConnection } = await import("./connections")
    if (!(await ensureActivePrincipalConnection(principal))) {
      return unauthorizedResponse(policy)
    }
  }
  if (policy.mechanisms && !policy.mechanisms.includes(principal.mechanism)) {
    return forbiddenResponse(policy)
  }
  if (policy.audience && principal.audience !== policy.audience) {
    return unauthorizedResponse(policy)
  }
  if (policy.scopes && !hasScopes(principal, policy.scopes)) {
    return forbiddenResponse(policy)
  }
  return principal
}

export function isAuthFailure(
  value: AuthPrincipal | Response
): value is Response {
  return value instanceof Response
}
