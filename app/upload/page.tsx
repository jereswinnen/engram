"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function UploadPage() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get("file") as File | null;
    if (!file || file.size === 0) {
      setError("Kies een audiobestand.");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const res = await fetch("/api/recordings", { method: "POST", body: data });
      if (!res.ok) {
        const msg = await res
          .json()
          .then((d: { error?: string }) => d.error ?? "Fout bij uploaden")
          .catch(() => "Fout bij uploaden");
        setError(msg);
        return;
      }
      const { id } = (await res.json()) as { id: string };
      router.push(`/recordings/${id}`);
    } catch {
      setError("Netwerkfout. Probeer opnieuw.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:underline mb-6 inline-block"
      >
        ← Terug
      </Link>
      <h1 className="text-xl font-semibold mb-4">Opname uploaden</h1>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="file" className="text-sm font-medium">
            Audiobestand
          </label>
          <Input id="file" name="file" type="file" accept="audio/*" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="title" className="text-sm font-medium">
            Titel{" "}
            <span className="text-muted-foreground font-normal">(optioneel)</span>
          </label>
          <Input
            id="title"
            name="title"
            type="text"
            placeholder="Gebruik bestandsnaam als titel"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={uploading}>
          {uploading ? "Uploaden…" : "Uploaden"}
        </Button>
      </form>
    </div>
  );
}
