"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RetryButton({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/recordings/${recordingId}/transcribe`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        setError("Retry failed. Please try again later.");
      }
    } catch {
      setError("Retry failed. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button variant="outline" onClick={handleRetry} disabled={loading}>
        {loading ? "Working…" : "Retry"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}
