"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Backup = { id: string; status: string; sizeBytes: number | null; error: string | null; createdAt: string };

function fmtSize(b: number | null) {
  if (b == null) return "";
  const mb = b / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
}

export function Backups({ initial }: { initial: Backup[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const pending = initial.some((b) => b.status === "pending");

  // Poll while any backup is still generating.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [pending, router]);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-medium">Backups</h2>
        <p className="text-sm text-muted-foreground">
          A full archive (audio + transcript + summary) of every recording, as a downloadable zip.
        </p>
      </div>
      <Button onClick={create} disabled={busy}>Create backup</Button>
      <ul className="flex flex-col gap-1 text-sm">
        {initial.length === 0 && <li className="text-muted-foreground">No backups yet.</li>}
        {initial.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">
              {new Date(b.createdAt).toLocaleString("en-GB")} —{" "}
              {b.status === "ready"
                ? `Ready ${fmtSize(b.sizeBytes)}`
                : b.status === "pending"
                  ? "Generating…"
                  : `Failed${b.error ? `: ${b.error}` : ""}`}
            </span>
            {b.status === "ready" && (
              <Button asChild variant="outline" size="sm">
                <a href={`/api/backup/${b.id}/download`}>Download</a>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
