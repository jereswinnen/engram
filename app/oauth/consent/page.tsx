import { notFound } from "next/navigation"
import { connection } from "next/server"
import { requireSession } from "@/lib/auth-guard"
import { oauthEnabled } from "@/lib/auth/oauth-feature"
import { OAuthConsent } from "./oauth-consent"

type SearchValue = string | string[] | undefined

export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, SearchValue>>
}) {
  await connection()
  if (!oauthEnabled()) notFound()
  await requireSession()
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [name, rawValue] of Object.entries(params)) {
    for (const value of Array.isArray(rawValue) ? rawValue : [rawValue]) {
      if (value !== undefined) query.append(name, value)
    }
  }

  const clientId = query.get("client_id")
  const scope = query.get("scope")
  if (!clientId || !scope || !query.get("sig")) notFound()

  return (
    <OAuthConsent
      clientId={clientId}
      scopes={scope.split(" ").filter(Boolean)}
      oauthQuery={query.toString()}
    />
  )
}
