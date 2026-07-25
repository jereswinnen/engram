"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RiAppsLine, RiMacLine, RiSmartphoneLine } from "@remixicon/react"
import { Button } from "@/components/ui/button"
import {
  groupActiveOAuthConnections,
  type OAuthConnectionItem,
} from "@/lib/auth/connection-groups"

type Connection = OAuthConnectionItem & { revokedAt: string | null }

function AppIcon({ clientId }: { clientId: string | null }) {
  if (clientId === "engram-macos") return <RiMacLine className="size-4" />
  if (clientId === "engram-ios") return <RiSmartphoneLine className="size-4" />
  return <RiAppsLine className="size-4" />
}

export function OAuthConnections({ initial }: { initial: Connection[] }) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const groups = groupActiveOAuthConnections(initial)

  async function revoke(key: string, ids: string[]) {
    setPendingKey(key)
    setError(null)
    const responses = await Promise.all(
      ids.map((id) =>
        fetch(`/api/auth/connections/${id}/revoke`, { method: "POST" })
      )
    )
    if (responses.some((response) => !response.ok)) {
      setError("Could not revoke every connection. Please try again.")
      setPendingKey(null)
      return
    }
    router.refresh()
  }

  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Connected apps</h2>
        <p className="text-sm text-muted-foreground">
          Manage apps that can access your Engram account.
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No OAuth apps have been connected yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {groups.map((connection) => (
            <li
              key={connection.key}
              className="rounded-lg border bg-background p-3"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <AppIcon clientId={connection.clientId} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{connection.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {connection.lastUsedAt
                        ? `Last used ${new Date(connection.lastUsedAt).toLocaleString()}`
                        : `Connected ${new Date(connection.createdAt).toLocaleString()}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pendingKey === connection.key}
                  onClick={() => revoke(connection.key, connection.ids)}
                >
                  {pendingKey === connection.key ? "Revoking…" : "Revoke"}
                </Button>
              </div>
              {connection.scopes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1 pl-11">
                  {connection.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
