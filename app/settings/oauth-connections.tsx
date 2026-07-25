"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

type Connection = {
  id: string
  label: string
  clientId: string | null
  status: string
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

export function OAuthConnections({ initial }: { initial: Connection[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function revoke(id: string) {
    setPendingId(id)
    setError(null)
    const response = await fetch(`/api/auth/connections/${id}/revoke`, {
      method: "POST",
    })
    if (!response.ok) {
      setError("Could not revoke this connection. Please try again.")
      setPendingId(null)
      return
    }
    router.refresh()
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Revoke a Mac, iOS, Codex, or Claude connection without changing your
          password.
        </p>
      </div>

      {initial.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No OAuth apps have been connected yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {initial.map((connection) => (
            <li
              key={connection.id}
              className="space-y-2 rounded-md bg-muted p-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">{connection.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {connection.clientId ?? "Client pending"} ·{" "}
                    {connection.status}
                  </p>
                </div>
                {connection.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pendingId === connection.id}
                    onClick={() => revoke(connection.id)}
                  >
                    {pendingId === connection.id ? "Revoking…" : "Revoke"}
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Created {new Date(connection.createdAt).toLocaleString()}
                {connection.lastUsedAt
                  ? ` · Last used ${new Date(connection.lastUsedAt).toLocaleString()}`
                  : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {connection.scopes.join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
