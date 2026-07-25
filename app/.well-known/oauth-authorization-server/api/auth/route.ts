import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider"
import { auth } from "@/auth"
import {
  oauthEnabled,
  oauthUnavailableResponse,
} from "@/lib/auth/oauth-feature"

export async function GET(request: Request): Promise<Response> {
  if (!oauthEnabled()) return oauthUnavailableResponse()
  const response = await oauthProviderAuthServerMetadata(auth)(request)
  response.headers.set("Cache-Control", "public, max-age=300")
  return response
}
