import { timingSafeEqual } from "node:crypto"
import { auth } from "@/auth"

export type RecordingAuthorization = "recorder" | "session"

export async function authorizeRecordingRequest(
  request: Request
): Promise<RecordingAuthorization | null> {
  const recorderToken = process.env.MAC_RECORDER_API_TOKEN
  const authorization = request.headers.get("authorization")
  if (recorderToken && authorization?.startsWith("Bearer ")) {
    const suppliedToken = Buffer.from(authorization.slice("Bearer ".length))
    const expectedToken = Buffer.from(recorderToken)
    if (
      suppliedToken.length === expectedToken.length &&
      timingSafeEqual(suppliedToken, expectedToken)
    ) {
      return "recorder"
    }
  }

  const session = await auth.api.getSession({ headers: request.headers })
  return session ? "session" : null
}

export async function isRecordingRequestAuthorized(
  request: Request
): Promise<boolean> {
  return Boolean(await authorizeRecordingRequest(request))
}
