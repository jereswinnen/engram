"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initialQuery);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="flex gap-2"
    >
      <Input
        placeholder="Search transcripts…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoFocus
      />
      <Button type="submit" disabled={q.trim().length === 0}>
        Search
      </Button>
    </form>
  );
}
