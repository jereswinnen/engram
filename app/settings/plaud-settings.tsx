"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type LastResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string } | null;

export function PlaudSettings({ connected, lastResult, oauthStatus }: { connected: boolean; lastResult: LastResult; oauthStatus: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(
    oauthStatus === "connected" ? "Plaud verbonden." : oauthStatus === "error" ? "Verbinden met Plaud mislukt." : null,
  );
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      await fetch("/api/plaud/disconnect", { method: "POST" });
      setStatus("Verbinding verbroken.");
      router.refresh();
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setStatus("Bezig met synchroniseren…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync mislukt");
      setStatus(json.error ? `Sync: ${json.error}` : `Sync klaar — ${json.newCount} nieuw, ${json.skippedCount} overgeslagen, ${json.failedCount} mislukt.`);
      router.refresh();
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-medium">Plaud-koppeling</h2>
        <p className="text-sm text-muted-foreground">Status: {connected ? "verbonden" : "niet verbonden"}.</p>
        {connected ? (
          <Button variant="outline" onClick={disconnect} disabled={busy}>Verbinding verbreken</Button>
        ) : (
          <Button asChild><a href="/api/plaud/connect">Verbind met Plaud</a></Button>
        )}
      </div>

      <div className="space-y-2">
        <Button onClick={syncNow} disabled={busy || !connected}>Nu synchroniseren</Button>
        {lastResult && (
          <p className="text-sm text-muted-foreground">
            Laatste sync: {new Date(lastResult.ranAt).toLocaleString("nl-BE")} — {lastResult.error ?? `${lastResult.newCount} nieuw, ${lastResult.skippedCount} overgeslagen, ${lastResult.failedCount} mislukt`}
          </p>
        )}
      </div>

      {status && <p className="text-sm">{status}</p>}
    </section>
  );
}
