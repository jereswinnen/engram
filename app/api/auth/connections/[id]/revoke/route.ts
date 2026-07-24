import { isAuthFailure, requirePrincipal } from "@/lib/auth/policy"
import { revokeOAuthConnection } from "@/lib/auth/oauth-connection-store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const principal = await requirePrincipal(request, {
    mechanisms: ["session"],
    scopes: ["settings:write"],
  })
  if (isAuthFailure(principal)) return principal

  const { id } = await params
  const revoked = await revokeOAuthConnection(principal.userId, id)
  if (!revoked) return Response.json({ error: "not_found" }, { status: 404 })
  console.info(
    "auth_event",
    JSON.stringify({
      outcome: "success",
      event: "connection_revoked",
      connectionId: id,
      userId: principal.userId,
    })
  )
  return Response.json({ revoked: true })
}
