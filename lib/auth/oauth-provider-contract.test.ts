import { createHash } from "node:crypto"
import {
  oauthProvider,
  oauthProviderAuthServerMetadata,
} from "@better-auth/oauth-provider"
import { oauthProviderResourceClient } from "@better-auth/oauth-provider/resource-client"
import { verifyJwsAccessToken } from "better-auth/oauth2"
import { getTestInstance } from "better-auth/test"
import { jwt } from "better-auth/plugins"
import { describe, expect, it } from "vitest"
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

    const register = (scope: string) =>
      auth.handler(
        new Request(`${URLS.issuer}/oauth2/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            client_name: "Untrusted client label",
            redirect_uris: ["http://127.0.0.1:43123/callback"],
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

    const allowed = await register(ENGRAM_MCP_SCOPES.join(" "))
    expect(allowed.status).toBe(200)
    await expect(allowed.json()).resolves.toMatchObject({
      token_endpoint_auth_method: "none",
      scope: ENGRAM_MCP_SCOPES.join(" "),
    })
  })
})
