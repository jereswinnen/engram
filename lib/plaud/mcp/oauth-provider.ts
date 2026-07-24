import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type {
  OAuthClientInformation,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { createPlaudAuthStore } from "./auth-store"
import { config } from "@/lib/config"

export class PlaudOAuthProvider implements OAuthClientProvider {
  private readonly store

  constructor(
    ownerId: string,
    attemptId?: string,
    private readonly oauthState?: string
  ) {
    this.store = createPlaudAuthStore(ownerId, attemptId)
  }

  get redirectUrl() {
    return config.plaudRedirectUrl()
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Engram",
      redirect_uris: [config.plaudRedirectUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
      scope: "openid", // VERIFY exact scopes at the live Connect step
    }
  }
  state(): string {
    if (!this.oauthState) throw new Error("Missing Plaud OAuth state")
    return this.oauthState
  }
  async clientInformation() {
    return this.store.getClientInfo()
  }
  async saveClientInformation(info: OAuthClientInformation) {
    await this.store.saveClientInfo(info)
  }
  async tokens() {
    return this.store.getTokens()
  }
  async saveTokens(tokens: OAuthTokens) {
    await this.store.saveTokens(tokens)
  }
  async redirectToAuthorization(url: URL) {
    await this.store.saveAuthorizationUrl(url.toString())
  }
  async saveCodeVerifier(v: string) {
    await this.store.saveCodeVerifier(v)
  }
  async codeVerifier() {
    const v = await this.store.getCodeVerifier()
    if (!v) throw new Error("Missing PKCE code_verifier")
    return v
  }
}
