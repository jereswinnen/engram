"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RegenerateButton({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRegenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/regenerate`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError("Regeneration failed. Please try again.");
      }
    } catch {
      setError("Regeneration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Button variant="outline" size="sm" onClick={handleRegenerate} disabled={loading}>
        {loading ? "Regenerating…" : "Regenerate summary"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Renamed a speaker? Regenerate to update owners &amp; summary.
      </p>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
