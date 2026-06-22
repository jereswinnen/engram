import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformation, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { plaudAuthStore } from "./auth-store";
import { config } from "@/lib/config";

export class PlaudOAuthProvider implements OAuthClientProvider {
  get redirectUrl() { return config.plaudRedirectUrl(); }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Engram",
      redirect_uris: [config.plaudRedirectUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client + PKCE
      scope: "openid", // VERIFY exact scopes at the live Connect step
    };
  }
  async clientInformation() { return plaudAuthStore.getClientInfo(); }
  async saveClientInformation(info: OAuthClientInformation) { await plaudAuthStore.saveClientInfo(info); }
  async tokens() { return plaudAuthStore.getTokens(); }
  async saveTokens(tokens: OAuthTokens) { await plaudAuthStore.saveTokens(tokens); }
  async redirectToAuthorization(url: URL) { await plaudAuthStore.saveAuthorizationUrl(url.toString()); }
  async saveCodeVerifier(v: string) { await plaudAuthStore.saveCodeVerifier(v); }
  async codeVerifier() {
    const v = await plaudAuthStore.getCodeVerifier();
    if (!v) throw new Error("Missing PKCE code_verifier");
    return v;
  }
}
