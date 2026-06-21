"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RetryButton({ recordingId }: { recordingId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRetry() {
    setLoading(true);
    try {
      await fetch(`/api/recordings/${recordingId}/transcribe`, {
        method: "POST",
      });
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" onClick={handleRetry} disabled={loading}>
      {loading ? "Bezig…" : "Opnieuw proberen"}
    </Button>
  );
}
