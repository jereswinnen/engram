"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ExportButtons({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);

  async function copyMarkdown() {
    const res = await fetch(`/api/recordings/${id}/export?format=md`);
    if (!res.ok) return;
    await navigator.clipboard.writeText(await res.text());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex gap-2">
      <Button asChild variant="outline" size="sm">
        <a href={`/api/recordings/${id}/export?format=md`}>Download .md</a>
      </Button>
      <Button asChild variant="outline" size="sm">
        <a href={`/api/recordings/${id}/export?format=json`}>Download .json</a>
      </Button>
      <Button variant="outline" size="sm" onClick={copyMarkdown}>
        {copied ? "Copied!" : "Copy Markdown"}
      </Button>
    </div>
  );
}
