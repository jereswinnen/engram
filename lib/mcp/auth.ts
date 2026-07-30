import type { AuthPrincipal } from "@/lib/auth/principal"
import {
  isAuthFailure,
  requirePrincipal,
  unauthorizedResponse,
  type AuthPolicy,
} from "@/lib/auth/policy"
import { oauthUrls } from "@/lib/auth/oauth-config"

const FORBIDDEN_TOKEN_PARAMETERS = [
  "access_token",
  "bearer_token",
  "token",
] as const

type RequirePrincipal = (
  request: Request,
  policy: AuthPolicy
) => Promise<AuthPrincipal | Response>

type McpAuthDependencies = {
  appUrl?: string
  requirePrincipal?: RequirePrincipal
}

export async function requireMcpPrincipal(
  request: Request,
  dependencies: McpAuthDependencies = {}
): Promise<AuthPrincipal | Response> {
  const requestUrl = new URL(request.url)
  const appUrl = (
    dependencies.appUrl ??
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    requestUrl.origin
  ).replace(/\/+$/, "")
  const urls = oauthUrls(appUrl)
  const policy: AuthPolicy = {
    audience: urls.mcpResource,
    mechanisms: ["oauth"],
    resourceMetadataUrl: urls.mcpProtectedResourceMetadata,
  }

  if (
    FORBIDDEN_TOKEN_PARAMETERS.some((parameter) =>
      requestUrl.searchParams.has(parameter)
    )
  ) {
    return Response.json({ error: "invalid_request" }, { status: 400 })
  }

  const authorization = request.headers.get("authorization")
  if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
    return unauthorizedResponse(policy)
  }

  const authenticate = dependencies.requirePrincipal ?? requirePrincipal
  const principal = await authenticate(request, policy)
  if (isAuthFailure(principal)) return principal
  return principal
}
