import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { requireSession } from "@/lib/auth-guard";

export default async function HomePage() {
  await requireSession();

  const recs = await db.query.recordings.findMany({
    orderBy: [desc(recordings.createdAt)],
  });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Recordings</h1>
        <Button asChild>
          <Link href="/upload">Upload</Link>
        </Button>
      </div>
      {recs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No recordings yet.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {recs.map((rec) => (
            <Link key={rec.id} href={`/recordings/${rec.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardHeader>
                  <CardTitle>{rec.title}</CardTitle>
                  <CardDescription>
                    {new Date(rec.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                    {" · "}
                    <span className="capitalize">{rec.status}</span>
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
