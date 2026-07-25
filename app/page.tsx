import Link from "next/link"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { requireSession } from "@/lib/auth-guard"
import { listOwnedRecordings } from "@/lib/recordings/store"

export default async function HomePage() {
  const session = await requireSession()
  const recs = await listOwnedRecordings(session.user.id)

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
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
              <Card className="cursor-pointer transition-shadow hover:shadow-md">
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
  )
}
