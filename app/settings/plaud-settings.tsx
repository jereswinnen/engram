"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LastResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string } | null;

export function PlaudSettings({ connected, lastResult }: { connected: boolean; lastResult: LastResult }) {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveToken() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch("/api/plaud/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "kon token niet opslaan");
      setToken("");
      setStatus(json.valid ? "Token opgeslagen en geldig." : "Token opgeslagen (kon niet valideren).");
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setStatus("Bezig met synchroniseren…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync mislukt");
      setStatus(json.error ? `Sync: ${json.error}` : `Sync klaar — ${json.newCount} nieuw, ${json.skippedCount} overgeslagen, ${json.failedCount} mislukt.`);
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-medium">Plaud-koppeling</h2>
        <p className="text-sm text-muted-foreground">
          Status: {connected ? "verbonden" : "niet verbonden"}. Plak je sessietoken van web.plaud.ai (localStorage <code>tokenstr</code>).
        </p>
        <div className="flex gap-2">
          <Input type="password" placeholder="bearer eyJ…" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button onClick={saveToken} disabled={busy || token.trim().length < 20}>Opslaan</Button>
        </div>
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
