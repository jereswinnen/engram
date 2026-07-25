import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { revokeOAuthConnection } from "@/lib/auth/oauth-connection-store"

export async function POST(request: Request) {
  const principal = await requirePrincipal(request, {
    mechanisms: ["oauth"],
  })
  if (isAuthFailure(principal)) return principal
  if (!principal.connectionId) {
    return Response.json({ error: "unauthorized" }, { status: 401 })
  }

  const revoked = await revokeOAuthConnection(
    principal.userId,
    principal.connectionId
  )
  if (!revoked) return Response.json({ error: "not_found" }, { status: 404 })
  console.info(
    "auth_event",
    JSON.stringify({
      outcome: "success",
      event: "connection_self_revoked",
      clientId: principal.clientId,
      connectionId: principal.connectionId,
      userId: principal.userId,
    })
  )
  return Response.json({ revoked: true })
}
