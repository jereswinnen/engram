import { requireSession } from "@/lib/auth-guard";
import { db } from "@/db";
import { PlaudSettings } from "./plaud-settings";
import { isConnected } from "@/lib/plaud/mcp/client";
import { getGlossary } from "@/lib/glossary/store";
import { GlossarySettings } from "./glossary-settings";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ plaud?: string }> }) {
  await requireSession();
  const { plaud } = await searchParams;
  const connected = await isConnected();
  const sync = await db.query.syncState.findFirst();
  const glossary = await getGlossary();
  return (
    <section className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <PlaudSettings connected={connected} lastResult={sync?.lastResult ?? null} oauthStatus={plaud ?? null} />
      <GlossarySettings entries={glossary.map((g) => ({ id: g.id, term: g.term, aliases: g.aliases }))} />
    </section>
  );
}
