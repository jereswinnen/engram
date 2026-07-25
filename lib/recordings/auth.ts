import { authenticateRequest, type AuthPrincipal } from "@/lib/auth/principal"

export type RecordingAuthorization = AuthPrincipal

export async function authorizeRecordingRequest(
  request: Request
): Promise<RecordingAuthorization | null> {
  return authenticateRequest(request)
}
