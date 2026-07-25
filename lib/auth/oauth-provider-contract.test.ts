import { createHash } from "node:crypto"
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider"
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import { getTestInstance } from "better-auth/test"
import { jwt } from "better-auth/plugins"
import { describe, expect, it, vi } from "vitest"
import {
  ENGRAM_MAC_CLIENT_ID,
  ENGRAM_MAC_REDIRECT_URI,
  ENGRAM_MAC_SCOPES,
  ENGRAM_MCP_SCOPES,
  ENGRAM_OAUTH_SCOPES,
  oauthUrls,
} from "./oauth-config"

const APP_URL = "http://localhost:3010"
const URLS = oauthUrls(APP_URL)
const TEST_CONNECTION_ID = "00000000-0000-4000-8000-000000000001"
const VERIFIER =
  "engram-phase-zero-pkce-verifier-that-is-long-enough-1234567890"
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")

const decodeJwtPayload = (token: string) =>
  JSON.parse(
    Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")
  ) as Record<string, unknown>

type TokenResponse = {
  access_token: string
  refresh_token?: string
  scope: string
  token_type: "Bearer"
}

function formRequest(path: string, body: URLSearchParams) {
  return new Request(`${URLS.issuer}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  })
}

async function issueAuthorizationCode(
  auth: { handler: (request: Request) => Promise<Response> },
  headers: Headers
) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: ENGRAM_MAC_CLIENT_ID,
    redirect_uri: ENGRAM_MAC_REDIRECT_URI,
    scope: ENGRAM_MAC_SCOPES.join(" "),
    resource: URLS.apiResource,
    state: "phase-zero-state",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  })
  const response = await auth.handler(
    new Request(`${URLS.issuer}/oauth2/authorize?${query}`, {
      headers: new Headers({
        ...Object.fromEntries(headers.entries()),
        accept: "text/html",
        "sec-fetch-mode": "navigate",
      }),
      redirect: "manual",
    })
  )

  expect(response.status).toBe(302)
  const callback = new URL(response.headers.get("location")!)
  expect(callback.origin).toBe("null")
  expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(
    ENGRAM_MAC_REDIRECT_URI
  )
  expect(callback.searchParams.get("state")).toBe("phase-zero-state")
  expect(callback.searchParams.get("iss")).toBe(URLS.issuer)
  return callback.searchParams.get("code")!
}

describe("pinned Better Auth OAuth provider", () => {
  it("completes public PKCE, refresh rotation, resource verification, and revoke", async () => {
    const { auth, signInWithTestUser } = await getTestInstance(
      {
        baseURL: APP_URL,
        plugins: [
          jwt({ jwt: { issuer: URLS.issuer } }),
          oauthProvider({
            loginPage: "/login",
            consentPage: "/oauth/consent",
            scopes: [...ENGRAM_OAUTH_SCOPES],
            validAudiences: [URLS.apiResource, URLS.mcpResource],
            accessTokenExpiresIn: 15 * 60,
            refreshTokenExpiresIn: 30 * 24 * 60 * 60,
            generateClientId: () => ENGRAM_MAC_CLIENT_ID,
            postLogin: {
              page: "/oauth/continue",
              shouldRedirect: () => false,
              consentReferenceId: () => TEST_CONNECTION_ID,
            },
            customAccessTokenClaims: ({ referenceId }) => ({
              connection_id: referenceId,
            }),
          }),
        ],
      },
      { port: 3010 }
    )
    const signedIn = await signInWithTestUser()

    const client = await auth.api.adminCreateOAuthClient({
      headers: signedIn.headers,
      body: {
        client_name: "Engram for macOS",
        redirect_uris: [ENGRAM_MAC_REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "native",
        scope: ENGRAM_MAC_SCOPES.join(" "),
        skip_consent: true,
        require_pkce: true,
      },
    })
    expect(client.client_id).toBe(ENGRAM_MAC_CLIENT_ID)
    expect(client.client_secret).toBeUndefined()

    const missingPkceQuery = new URLSearchParams({
      response_type: "code",
      client_id: ENGRAM_MAC_CLIENT_ID,
      redirect_uri: ENGRAM_MAC_REDIRECT_URI,
      scope: ENGRAM_MAC_SCOPES.join(" "),
      resource: URLS.apiResource,
      state: "missing-pkce",
    })
    const missingPkce = await auth.handler(
      new Request(`${URLS.issuer}/oauth2/authorize?${missingPkceQuery}`, {
        headers: signedIn.headers,
        redirect: "manual",
      })
    )
    expect(missingPkce.status).toBe(302)
    expect(
      new URL(missingPkce.headers.get("location")!).searchParams.get("error")
    ).toBe("invalid_request")

    const redirectMismatch = await auth.handler(
      new Request(
        `${URLS.issuer}/oauth2/authorize?${new URLSearchParams({
          response_type: "code",
          client_id: ENGRAM_MAC_CLIENT_ID,
          redirect_uri: "jeremys.engram.recorder://oauth/wrong",
          scope: ENGRAM_MAC_SCOPES.join(" "),
          resource: URLS.apiResource,
          state: "redirect-mismatch",
          code_challenge: CHALLENGE,
          code_challenge_method: "S256",
        })}`,
        { headers: signedIn.headers, redirect: "manual" }
      )
    )
    expect(redirectMismatch.status).toBe(302)
    const redirectMismatchLocation = new URL(
      redirectMismatch.headers.get("location")!
    )
    expect(redirectMismatchLocation.pathname).toBe("/api/auth/error")
    expect(redirectMismatchLocation.searchParams.get("error")).toBe(
      "invalid_redirect"
    )
    expect(redirectMismatchLocation.href).not.toContain(
      encodeURIComponent("jeremys.engram.recorder://oauth/wrong")
    )

    const metadataResponse = await oauthProviderAuthServerMetadata(auth)(
      new Request(URLS.authorizationServerMetadata)
    )
    const metadata = await metadataResponse.json()
    expect(metadata).toMatchObject({
      issuer: URLS.issuer,
      authorization_endpoint: `${URLS.issuer}/oauth2/authorize`,
      token_endpoint: `${URLS.issuer}/oauth2/token`,
      revocation_endpoint: `${URLS.issuer}/oauth2/revoke`,
      code_challenge_methods_supported: ["S256"],
    })

    const wrongVerifierCode = await issueAuthorizationCode(
      auth,
      signedIn.headers
    )
    const wrongVerifierResponse = await auth.handler(
      formRequest(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ENGRAM_MAC_CLIENT_ID,
          redirect_uri: ENGRAM_MAC_REDIRECT_URI,
          code: wrongVerifierCode,
          code_verifier: `${VERIFIER}-wrong`,
          resource: URLS.apiResource,
        })
      )
    )
    expect(wrongVerifierResponse.status).toBe(401)
    await expect(wrongVerifierResponse.json()).resolves.toMatchObject({
      error: "invalid_request",
    })

    const code = await issueAuthorizationCode(auth, signedIn.headers)
    const tokenResponse = await auth.handler(
      formRequest(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ENGRAM_MAC_CLIENT_ID,
          redirect_uri: ENGRAM_MAC_REDIRECT_URI,
          code,
          code_verifier: VERIFIER,
          resource: URLS.apiResource,
        })
      )
    )
    expect(tokenResponse.status).toBe(200)
    const first = (await tokenResponse.json()) as TokenResponse
    expect(first.refresh_token).toBeTruthy()
    expect(first.scope.split(" ")).toEqual(
      expect.arrayContaining([...ENGRAM_MAC_SCOPES])
    )

    const payload = decodeJwtPayload(first.access_token)
    expect(payload).toMatchObject({
      sub: signedIn.user.id,
      aud: URLS.apiResource,
      azp: ENGRAM_MAC_CLIENT_ID,
      connection_id: TEST_CONNECTION_ID,
    })

    const replayResponse = await auth.handler(
      formRequest(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: ENGRAM_MAC_CLIENT_ID,
          redirect_uri: ENGRAM_MAC_REDIRECT_URI,
          code,
          code_verifier: VERIFIER,
          resource: URLS.apiResource,
        })
      )
    )
    expect(replayResponse.status).toBe(401)
    await expect(replayResponse.json()).resolves.toMatchObject({
      error: "invalid_grant",
    })

    const resource = oauthProviderResourceClient(auth).getActions()
    const protectedMetadata = await resource.getProtectedResourceMetadata({
      resource: URLS.apiResource,
      scopes_supported: ["recordings:write", "recordings:delete-own"],
    })
    expect(protectedMetadata).toMatchObject({
      resource: URLS.apiResource,
      authorization_servers: [URLS.issuer],
    })
    const jwksFetch = async () => auth.api.getJwks()
    await expect(
      verifyJwsAccessToken(first.access_token, {
        jwksFetch,
        verifyOptions: { audience: URLS.apiResource, issuer: URLS.issuer },
      })
    ).resolves.toMatchObject({ sub: signedIn.user.id, aud: URLS.apiResource })
    await expect(
      verifyJwsAccessToken(first.access_token, {
        jwksFetch,
        verifyOptions: { audience: URLS.mcpResource, issuer: URLS.issuer },
      })
    ).rejects.toThrow()

    const refreshResponse = await auth.handler(
      formRequest(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: ENGRAM_MAC_CLIENT_ID,
          refresh_token: first.refresh_token!,
          resource: URLS.apiResource,
        })
      )
    )
    expect(refreshResponse.status).toBe(200)
    const rotated = (await refreshResponse.json()) as TokenResponse
    expect(rotated.refresh_token).toBeTruthy()
    expect(rotated.refresh_token).not.toBe(first.refresh_token)
    expect(decodeJwtPayload(rotated.access_token).connection_id).toBe(
      TEST_CONNECTION_ID
    )

    const revokeResponse = await auth.handler(
      formRequest(
        "/oauth2/revoke",
        new URLSearchParams({
          client_id: ENGRAM_MAC_CLIENT_ID,
          token: rotated.refresh_token!,
          token_type_hint: "refresh_token",
        })
      )
    )
    expect(revokeResponse.status).toBe(200)

    const revokedRefresh = await auth.handler(
      formRequest(
        "/oauth2/token",
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: ENGRAM_MAC_CLIENT_ID,
          refresh_token: rotated.refresh_token!,
          resource: URLS.apiResource,
        })
      )
    )
    expect(revokedRefresh.status).toBe(400)
    await expect(revokedRefresh.json()).resolves.toMatchObject({
      error: "invalid_grant",
    })
  })

  it("limits unauthenticated dynamic registration to MCP read scopes", async () => {
    const { auth } = await getTestInstance(
      {
        baseURL: APP_URL,
        plugins: [
          jwt({ jwt: { issuer: URLS.issuer } }),
          oauthProvider({
            loginPage: "/login",
            consentPage: "/oauth/consent",
            scopes: [...ENGRAM_OAUTH_SCOPES],
            validAudiences: [URLS.apiResource, URLS.mcpResource],
            allowDynamicClientRegistration: true,
            allowUnauthenticatedClientRegistration: true,
            clientRegistrationDefaultScopes: [...ENGRAM_MCP_SCOPES],
            clientRegistrationAllowedScopes: [...ENGRAM_MCP_SCOPES],
          }),
        ],
      },
      { port: 3010 }
    )

    const register = (
      scope: string,
      redirectUri = "http://127.0.0.1:43123/callback"
    ) =>
      auth.handler(
        new Request(`${URLS.issuer}/oauth2/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: "Untrusted client label",
            redirect_uris: [redirectUri],
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            type: "native",
            scope,
          }),
        })
      )

    const denied = await register("recordings:write offline_access")
    expect(denied.status).toBe(400)
    await expect(denied.json()).resolves.toMatchObject({
      error: "invalid_scope",
    })

    const unsafeRedirect = await register(
      ENGRAM_MCP_SCOPES.join(" "),
      "javascript:alert(1)"
    )
    expect(unsafeRedirect.status).toBe(400)

    const allowed = await register(ENGRAM_MCP_SCOPES.join(" "))
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toMatchObject({
      token_endpoint_auth_method: "none",
      scope: ENGRAM_MCP_SCOPES.join(" "),
    })
  })

  it("rejects consent when a signed OAuth query is tampered with", async () => {
    const { auth, signInWithTestUser } = await getTestInstance(
      {
        baseURL: APP_URL,
        plugins: [
          jwt({ jwt: { issuer: URLS.issuer } }),
          oauthProvider({
            loginPage: "/login",
            consentPage: "/oauth/consent",
            scopes: [...ENGRAM_OAUTH_SCOPES],
            validAudiences: [URLS.apiResource],
            generateClientId: () => "consent-client",
            postLogin: {
              page: "/oauth/continue",
              shouldRedirect: () => false,
              consentReferenceId: () => TEST_CONNECTION_ID,
            },
          }),
        ],
      },
      { port: 3010 }
    )
    const signedIn = await signInWithTestUser()
    await auth.api.adminCreateOAuthClient({
      headers: signedIn.headers,
      body: {
        client_name: "Consent test",
        redirect_uris: ["http://127.0.0.1:43210/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        type: "native",
        scope: "transcripts:read offline_access",
        require_pkce: true,
      },
    })

    const authorizeQuery = new URLSearchParams({
      response_type: "code",
      client_id: "consent-client",
      redirect_uri: "http://127.0.0.1:43210/callback",
      scope: "transcripts:read offline_access",
      resource: URLS.apiResource,
      state: "original-state",
      code_challenge: CHALLENGE,
      code_challenge_method: "S256",
    })
    const authorizeResponse = await auth.handler(
      new Request(`${URLS.issuer}/oauth2/authorize?${authorizeQuery}`, {
        headers: signedIn.headers,
        redirect: "manual",
      })
    )
    expect(authorizeResponse.status).toBe(302)
    const consentLocation = new URL(
      authorizeResponse.headers.get("location")!,
      APP_URL
    )
    expect(consentLocation.pathname).toBe("/oauth/consent")
    consentLocation.searchParams.set("state", "tampered-state")

    const consentResponse = await auth.handler(
      new Request(`${URLS.issuer}/oauth2/consent`, {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(signedIn.headers.entries()),
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          accept: true,
          oauth_query: consentLocation.searchParams.toString(),
        }),
      })
    )
    expect(consentResponse.ok).toBe(false)
  })

  it("keeps old signing keys during overlap and retires them afterward", async () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-07-24T12:00:00Z"))
    try {
      const { auth, signInWithTestUser } = await getTestInstance(
        {
          baseURL: APP_URL,
          plugins: [
            jwt({
              disableSettingJwtHeader: true,
              jwt: { issuer: URLS.issuer },
              jwks: {
                keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
                rotationInterval: 1,
                gracePeriod: 3,
              },
            }),
          ],
        },
        { port: 3010 }
      )
      const signedIn = await signInWithTestUser()
      const first = await auth.api.getToken({ headers: signedIn.headers })

      vi.setSystemTime(new Date("2026-07-24T12:00:02Z"))
      await auth.api.getToken({ headers: signedIn.headers })
      expect((await auth.api.getJwks()).keys).toHaveLength(2)
      await expect(
        verifyJwsAccessToken(first.token, {
          jwksFetch: () => auth.api.getJwks(),
          verifyOptions: { audience: APP_URL, issuer: URLS.issuer },
        })
      ).resolves.toMatchObject({ sub: signedIn.user.id })

      vi.setSystemTime(new Date("2026-07-24T12:00:06Z"))
      await auth.api.getToken({ headers: signedIn.headers })
      expect((await auth.api.getJwks()).keys).toHaveLength(1)
      await expect(
        verifyJwsAccessToken(first.token, {
          jwksFetch: () => auth.api.getJwks(),
          verifyOptions: { audience: APP_URL, issuer: URLS.issuer },
        })
      ).rejects.toThrow()
    } finally {
      vi.useRealTimers()
    }
  })
})
