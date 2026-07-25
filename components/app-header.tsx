"use client"

import { FormEvent, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  RiArchiveLine,
  RiLogoutBoxRLine,
  RiSearchLine,
  RiSettings3Line,
  RiUploadCloud2Line,
} from "@remixicon/react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

const links = [
  { href: "/", label: "Library", icon: RiArchiveLine },
  { href: "/search", label: "Search", icon: RiSearchLine },
  { href: "/settings", label: "Settings", icon: RiSettings3Line },
]

export function AppHeader({ initials }: { initials: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [signingOut, setSigningOut] = useState(false)

  if (pathname === "/login" || pathname.startsWith("/oauth/")) return null

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = query.trim()
    if (value) router.push(`/search?q=${encodeURIComponent(value)}`)
  }

  async function signOut() {
    setSigningOut(true)
    await authClient.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 lg:px-6">
        <Link
          href="/"
          className="mr-1 shrink-0 text-base font-semibold tracking-[-0.02em]"
        >
          Engram
        </Link>

        <form
          onSubmit={search}
          className="relative hidden w-full max-w-md md:block"
        >
          <RiSearchLine className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            aria-label="Search recordings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recordings and transcripts"
            className="h-9 w-full rounded-lg border-0 bg-muted/70 pr-3 pl-9 text-sm ring-1 ring-transparent transition outline-none placeholder:text-muted-foreground focus:bg-background focus:ring-border"
          />
        </form>

        <nav
          aria-label="Main navigation"
          className="ml-auto flex items-center gap-0.5"
        >
          {links.map(({ href, label, icon: Icon }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:px-2.5",
                  active && "bg-muted text-foreground"
                )}
              >
                <Icon className="size-4" />
                <span className="hidden lg:inline">{label}</span>
              </Link>
            )
          })}
          <Link
            href="/upload"
            className="ml-1.5 flex h-8 items-center gap-1.5 rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/85"
          >
            <RiUploadCloud2Line className="size-4" />
            <span className="hidden sm:inline">Upload</span>
          </Link>
          <div className="ml-1.5 flex items-center gap-0.5">
            <span className="grid size-8 place-items-center rounded-full bg-muted text-xs font-medium">
              {initials}
            </span>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Log out"
              title="Log out"
              className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              <RiLogoutBoxRLine className="size-4" />
            </button>
          </div>
        </nav>
      </div>
    </header>
  )
}
