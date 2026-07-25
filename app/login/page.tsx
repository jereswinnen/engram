"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { authClient } from "@/lib/auth-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message ?? "Sign-in failed. Please try again.")
      setPending(false)
      return
    }

    const oauthQuery = searchParams.get("sig") ? searchParams.toString() : null
    const raw = oauthQuery
      ? `/api/auth/oauth2/authorize?${oauthQuery}`
      : (searchParams.get("callbackUrl") ?? "")
    const destination = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/"
    router.push(destination)
    router.refresh()
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/20 px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-[0_18px_60px_rgba(0,0,0,0.06)] sm:p-8">
        <div className="mb-7 text-center">
          <p className="mb-4 text-sm font-semibold tracking-[-0.025em]">
            Engram
          </p>
          <h1 className="text-xl font-semibold tracking-[-0.035em]">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in to your Engram workspace.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="text-sm font-medium">
              Email address
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            size="lg"
            className="mt-2 w-full rounded-xl"
            disabled={pending}
          >
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </main>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
