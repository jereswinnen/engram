import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { jwt } from "better-auth/plugins"
import { oauthProvider } from "@better-auth/oauth-provider"
import { db } from "@/db"
import * as schema from "@/db/schema"
import {
  ENGRAM_MAC_CLIENT_ID,
  ENGRAM_MCP_SCOPES,
  ENGRAM_OAUTH_SCOPES,
  oauthUrls,
} from "@/lib/auth/oauth-config"
import {
  activateOAuthConnection,
  createPendingOAuthConnection,
  requireActiveOAuthConnection,
} from "@/lib/auth/oauth-connections"

if (!process.env.BETTER_AUTH_SECRET)
  throw new Error("BETTER_AUTH_SECRET is required")

const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL
if (!appUrl)
  throw new Error("BETTER_AUTH_URL or NEXT_PUBLIC_APP_URL is required")
const urls = oauthUrls(appUrl)

export const auth = betterAuth({
  baseURL: urls.app,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
    usePlural: false,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh every 24 h
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5-minute optimistic cache
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [
    jwt({
      disableSettingJwtHeader: true,
      jwt: { issuer: urls.issuer },
      jwks: {
        keyPairConfig: { alg: "EdDSA", crv: "Ed25519" },
        rotationInterval: 7 * 24 * 60 * 60,
        gracePeriod: 30 * 24 * 60 * 60,
      },
    }),
    oauthProvider({
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: [...ENGRAM_OAUTH_SCOPES],
      validAudiences: [urls.apiResource, urls.mcpResource],
      accessTokenExpiresIn: 15 * 60,
      refreshTokenExpiresIn: 30 * 24 * 60 * 60,
      codeExpiresIn: 10 * 60,
      grantTypes: ["authorization_code", "refresh_token"],
      cachedTrustedClients: new Set([ENGRAM_MAC_CLIENT_ID]),
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultScopes: [...ENGRAM_MCP_SCOPES],
      clientRegistrationAllowedScopes: [...ENGRAM_MCP_SCOPES],
      silenceWarnings: { oauthAuthServerConfig: true },
      postLogin: {
        page: "/oauth/continue",
        shouldRedirect: () => false,
        consentReferenceId: ({ user, scopes }) =>
          createPendingOAuthConnection({ user, scopes }),
      },
      customTokenResponseFields: async ({
        user,
        scopes,
        verificationValue,
      }) => {
        await activateOAuthConnection({
          user,
          scopes,
          verification: verificationValue,
        })
        console.info(
          "auth_event",
          JSON.stringify({
            event: verificationValue
              ? "oauth_code_exchanged"
              : "oauth_refreshed",
            outcome: "success",
            userId: user?.id,
            clientId: verificationValue?.query.client_id,
            connectionId: verificationValue?.referenceId,
          })
        )
        return {}
      },
      customAccessTokenClaims: async ({
        user,
        referenceId,
        resource,
        scopes,
      }) => ({
        connection_id: await requireActiveOAuthConnection({
          user,
          referenceId,
          resource,
          scopes,
        }),
      }),
      advertisedMetadata: {
        scopes_supported: [...ENGRAM_OAUTH_SCOPES],
        claims_supported: [
          "sub",
          "iss",
          "aud",
          "exp",
          "iat",
          "scope",
          "azp",
          "connection_id",
        ],
      },
      rateLimit: {
        token: { window: 60, max: 20 },
        authorize: { window: 60, max: 30 },
        introspect: { window: 60, max: 60 },
        revoke: { window: 60, max: 20 },
        register: { window: 60, max: 5 },
        userinfo: { window: 60, max: 30 },
      },
    }),
    // Must remain last so cookies set by OAuth handlers reach Next.js.
    nextCookies(),
  ],
})
