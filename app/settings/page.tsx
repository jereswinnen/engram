import { requireSession } from "@/lib/auth-guard"
import { db } from "@/db"
import { PlaudSettings } from "./plaud-settings"
import { isConnected } from "@/lib/plaud/mcp/client"
import { getGlossary } from "@/lib/glossary/store"
import { GlossarySettings } from "./glossary-settings"
import { getBackups } from "@/lib/backup/store"
import { Backups } from "./backups"
import { ownerPredicate } from "@/lib/auth/ownership"

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
  return (
    <section className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <PlaudSettings
        connected={connected}
        lastResult={sync?.lastResult ?? null}
        oauthStatus={plaud ?? null}
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
    </section>
  )
}
