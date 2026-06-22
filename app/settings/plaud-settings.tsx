"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type LastResult = { ranAt: string; newCount: number; skippedCount: number; failedCount: number; error?: string } | null;

export function PlaudSettings({ connected, lastResult, oauthStatus }: { connected: boolean; lastResult: LastResult; oauthStatus: string | null }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(
    oauthStatus === "connected" ? "Plaud connected." : oauthStatus === "error" ? "Failed to connect to Plaud." : null,
  );
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch("/api/plaud/disconnect", { method: "POST" });
      if (res.ok) {
        setStatus("Disconnected.");
        router.refresh();
      } else {
        setStatus("Failed to disconnect.");
      }
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setStatus("Syncing…");
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "sync failed");
      setStatus(json.error ? `Sync: ${json.error}` : `Sync complete — ${json.newCount} new, ${json.skippedCount} skipped, ${json.failedCount} failed.`);
      router.refresh();
    } catch (e) { setStatus((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h2 className="font-medium">Plaud connection</h2>
        <p className="text-sm text-muted-foreground">Status: {connected ? "connected" : "not connected"}.</p>
        {connected ? (
          <Button variant="outline" onClick={disconnect} disabled={busy}>Disconnect</Button>
        ) : (
          <Button asChild><a href="/api/plaud/connect">Connect Plaud</a></Button>
        )}
      </div>

      <div className="space-y-2">
        <Button onClick={syncNow} disabled={busy || !connected}>Sync now</Button>
        {lastResult && (
          <p className="text-sm text-muted-foreground">
            Last sync: {new Date(lastResult.ranAt).toLocaleString("en-GB")} — {lastResult.error ?? `${lastResult.newCount} new, ${lastResult.skippedCount} skipped, ${lastResult.failedCount} failed`}
          </p>
        )}
      </div>

      {status && <p className="text-sm">{status}</p>}
    </section>
  );
}
