"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

const SCOPE_LABELS: Record<string, string> = {
  "recordings:write": "Upload new recordings",
  "recordings:delete-own": "Delete recordings created by this connection",
  "recordings:read": "View your recordings",
  "transcripts:search": "Search your transcript content",
  "transcripts:read": "Read full transcript content",
  offline_access: "Stay connected when Engram is closed",
}

export function OAuthConsent({
  clientId,
  scopes,
  oauthQuery,
}: {
  clientId: string
  scopes: string[]
  oauthQuery: string
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(accept: boolean) {
    setPending(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/oauth2/consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept, oauth_query: oauthQuery }),
      })
      const result = (await response.json()) as {
        url?: string
        message?: string
        error_description?: string
      }
      if (!response.ok || !result.url) {
        throw new Error(
          result.error_description ?? result.message ?? "Authorization failed"
        )
      }
      window.location.assign(result.url)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authorization failed")
      setPending(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md space-y-6 rounded-xl border p-6 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Connect to Engram</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{clientId}</span> is
            requesting access. Client-provided names and details are unverified.
          </p>
        </div>

        <ul className="space-y-2 text-sm">
          {scopes.map((scope) => (
            <li key={scope} className="rounded-md bg-muted px-3 py-2">
              {SCOPE_LABELS[scope] ?? scope}
            </li>
          ))}
        </ul>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-3">
          <Button onClick={() => decide(true)} disabled={pending}>
            {pending ? "Connecting…" : "Allow"}
          </Button>
          <Button
            variant="outline"
            onClick={() => decide(false)}
            disabled={pending}
          >
            Deny
          </Button>
        </div>
      </section>
    </main>
  )
}
