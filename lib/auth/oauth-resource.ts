import type { JWTPayload } from "better-auth"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import { ENGRAM_OAUTH_SCOPES, oauthUrls } from "./oauth-config"
import type { AuthPrincipal } from "./principal"

type VerifyJwt = (
  token: string,
  options: {
    audience: string
    issuer: string
  }
) => Promise<JWTPayload>

type OAuthVerificationDependencies = {
  appUrl?: string
  verifyJwt?: VerifyJwt
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function verifyOAuthBearerToken(
  request: Request,
  token: string,
  dependencies: OAuthVerificationDependencies = {}
): Promise<AuthPrincipal | null> {
  const appUrl =
    dependencies.appUrl ??
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL
  if (!appUrl) return null

  const urls = oauthUrls(appUrl)
  const audience = new URL(request.url).pathname.startsWith("/mcp")
    ? urls.mcpResource
    : urls.apiResource

  try {
    const payload = await (dependencies.verifyJwt ?? defaultVerifyJwt)(token, {
      audience,
      issuer: urls.issuer,
    })
    if (
      typeof payload.sub !== "string" ||
      typeof payload.azp !== "string" ||
      typeof payload.connection_id !== "string" ||
      !UUID_PATTERN.test(payload.connection_id) ||
      typeof payload.scope !== "string"
    ) {
      return null
    }

    const scopes = payload.scope.split(" ").filter(Boolean)
    const supportedScopes = new Set<string>(ENGRAM_OAUTH_SCOPES)
    if (scopes.some((scope) => !supportedScopes.has(scope))) return null

    return {
      userId: payload.sub,
      mechanism: "oauth",
      scopes: new Set(scopes),
      audience,
      clientId: payload.azp,
      grantId: payload.connection_id,
      connectionId: payload.connection_id,
    }
  } catch {
    return null
  }
}

async function defaultVerifyJwt(
  token: string,
  options: { audience: string; issuer: string }
): Promise<JWTPayload> {
  const { auth } = await import("@/auth")
  return verifyJwsAccessToken(token, {
    jwksFetch: () => auth.api.getJwks(),
    verifyOptions: {
      algorithms: ["EdDSA"],
      audience: options.audience,
      issuer: options.issuer,
    },
  })
}
