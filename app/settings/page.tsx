import { requireSession } from "@/lib/auth-guard"
import { db } from "@/db"
import { PlaudSettings } from "./plaud-settings"
import { isConnected } from "@/lib/plaud/mcp/client"
import { getGlossary } from "@/lib/glossary/store"
import { GlossarySettings } from "./glossary-settings"
import { getBackups } from "@/lib/backup/store"
import { Backups } from "./backups"
import { ownerPredicate } from "@/lib/auth/ownership"
import { listOAuthConnections } from "@/lib/auth/oauth-connection-store"
import { OAuthConnections } from "./oauth-connections"

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ plaud?: string }>
}) {
  const session = await requireSession()
  const { plaud } = await searchParams
  const connected = await isConnected(session.user.id)
  const sync = await db.query.syncState.findFirst({
    where: (table) => ownerPredicate(table.ownerId, session.user.id),
  })
  const glossary = await getGlossary(session.user.id)
  const backups = await getBackups(session.user.id)
  const oauthConnections = await listOAuthConnections(session.user.id)
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 border-b pb-5">
        <p className="mb-1 text-xs font-medium text-muted-foreground">
          Workspace preferences
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.035em]">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage integrations, transcription vocabulary, connected apps, and
          exports.
        </p>
      </header>
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <PlaudSettings
          connected={connected}
          lastResult={sync?.lastResult ?? null}
          oauthStatus={plaud ?? null}
        />
        <OAuthConnections
          initial={oauthConnections.map((connection) => ({
            id: connection.id,
            label: connection.label,
            clientId: connection.clientId,
            status: connection.status,
            scopes: connection.scopes,
            createdAt: connection.createdAt.toISOString(),
            lastUsedAt: connection.lastUsedAt?.toISOString() ?? null,
            revokedAt: connection.revokedAt?.toISOString() ?? null,
          }))}
        />
        <GlossarySettings
          entries={glossary.map((g) => ({
            id: g.id,
            term: g.term,
            aliases: g.aliases,
          }))}
        />
        <Backups
          initial={backups.map((b) => ({
            id: b.id,
            status: b.status,
            sizeBytes: b.sizeBytes,
            error: b.error,
            createdAt: b.createdAt.toISOString(),
          }))}
        />
      </div>
    </main>
  )
}
