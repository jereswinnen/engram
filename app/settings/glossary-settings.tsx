"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Entry = { id: string; term: string; aliases: string[] };

export function GlossarySettings({ entries }: { entries: Entry[] }) {
  const router = useRouter();
  const [term, setTerm] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/glossary", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ term, aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean) }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not add term");
      setTerm(""); setAliases(""); router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/glossary/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not delete term");
      router.refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="font-medium">Glossary</h2>
        <p className="text-sm text-muted-foreground">Terms and names to spell correctly in transcripts and summaries. Aliases (comma-separated) are common mishearings to auto-correct.</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Term (e.g. Riffado)" value={term} onChange={(e) => setTerm(e.target.value)} />
        <Input placeholder="Aliases: Rifado, riff a do" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        <Button onClick={add} disabled={busy || term.trim().length === 0}>Add</Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <ul className="space-y-1">
        {entries.length === 0 && <li className="text-sm text-muted-foreground">No terms yet.</li>}
        {entries.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
            <span><strong>{e.term}</strong>{e.aliases.length > 0 && <span className="text-muted-foreground"> — {e.aliases.join(", ")}</span>}</span>
            <Button variant="outline" size="sm" onClick={() => remove(e.id)} disabled={busy}>Delete</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
