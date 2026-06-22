import { requireSession } from "@/lib/auth-guard";
import { db } from "@/db";
import { PlaudSettings } from "./plaud-settings";
import { hasPlaudToken } from "@/lib/plaud/credentials";

export default async function SettingsPage() {
  await requireSession();
  const connected = await hasPlaudToken();
  const sync = await db.query.syncState.findFirst();
  return (
    <section className="mx-auto max-w-2xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Instellingen</h1>
      <PlaudSettings connected={connected} lastResult={sync?.lastResult ?? null} />
    </section>
  );
}
