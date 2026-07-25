"use client"

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  RiArchiveLine,
  RiCommandLine,
  RiLoader4Line,
  RiLogoutBoxRLine,
  RiMoonLine,
  RiSearchLine,
  RiSettings3Line,
  RiSunLine,
} from "@remixicon/react"
import { useTheme } from "next-themes"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"

const links = [
  { href: "/", label: "Library", icon: RiArchiveLine },
  { href: "/search", label: "Search", icon: RiSearchLine },
  { href: "/settings", label: "Settings", icon: RiSettings3Line },
]

type RecentRecording = {
  id: string
  title: string
  createdAt: string
  durationSeconds: number | null
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return null
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.floor(seconds % 60)
  return `${minutes}:${remainder.toString().padStart(2, "0")}`
}

function subscribeToHydration() {
  return () => undefined
}

function getClientHydrationSnapshot() {
  return true
}

function getServerHydrationSnapshot() {
  return false
}

function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
}: {
  href: string
  label: string
  icon: typeof RiArchiveLine
  active: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium transition-colors",
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  )
}

export function AppHeader({
  initials,
  name,
  email,
  recentRecordings,
}: {
  initials: string
  name: string
  email: string
  recentRecordings: RecentRecording[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [signingOut, setSigningOut] = useState(false)
  const themeMounted = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot
  )
  const { resolvedTheme, setTheme } = useTheme()
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", focusSearch)
    return () => window.removeEventListener("keydown", focusSearch)
  }, [])

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

  const activeRecording = pathname.startsWith("/recordings/")
    ? pathname.split("/")[2]
    : null
  const darkTheme = themeMounted && resolvedTheme === "dark"

  return (
    <>
      <header className="sticky top-0 z-40 flex h-12 items-center border-b bg-background/95 px-3 backdrop-blur lg:hidden">
        <Link
          href="/"
          className="text-[15px] font-semibold tracking-[-0.025em]"
        >
          Engram
        </Link>
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
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  active && "bg-muted text-foreground"
                )}
              >
                <Icon className="size-4" />
              </Link>
            )
          })}
        </nav>
      </header>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-sidebar-border bg-sidebar px-2.5 py-3 text-sidebar-foreground lg:flex">
        <div className="flex h-8 items-center justify-between px-2">
          <Link
            href="/"
            className="text-[15px] font-semibold tracking-[-0.025em]"
          >
            Engram
          </Link>
          <span
            className="grid size-7 place-items-center rounded-lg text-sidebar-foreground/45"
            aria-hidden
          >
            <RiCommandLine className="size-4" />
          </span>
        </div>

        <form onSubmit={search} className="relative mt-3">
          <RiSearchLine className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-sidebar-foreground/45" />
          <input
            ref={searchRef}
            aria-label="Search recordings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recordings"
            className="h-8 w-full rounded-lg border border-sidebar-border bg-background/65 pr-10 pl-8 text-xs transition outline-none placeholder:text-sidebar-foreground/45 focus:border-ring focus:bg-background focus:ring-2 focus:ring-ring/15"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-sidebar-border bg-background/70 px-1 py-0.5 font-sans text-[9px] text-sidebar-foreground/45">
            ⌘K
          </kbd>
        </form>

        <nav
          aria-label="Main navigation"
          className="mt-3 flex flex-col gap-0.5"
        >
          {links.map(({ href, label, icon }) => (
            <SidebarLink
              key={href}
              href={href}
              label={label}
              icon={icon}
              active={
                href === "/" ? pathname === "/" : pathname.startsWith(href)
              }
            />
          ))}
        </nav>

        <div className="my-3 border-t border-sidebar-border" />
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <p className="text-[11px] font-medium text-sidebar-foreground/55">
              Recent recordings
            </p>
            <span className="text-[10px] text-sidebar-foreground/35 tabular-nums">
              {recentRecordings.length}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
            {recentRecordings.length === 0 ? (
              <p className="px-2 py-3 text-xs leading-5 text-sidebar-foreground/45">
                Your recent recordings will appear here.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {recentRecordings.map((recording) => {
                  const active = activeRecording === recording.id
                  const recordingDuration = formatDuration(
                    recording.durationSeconds
                  )
                  return (
                    <li key={recording.id}>
                      <Link
                        href={`/recordings/${recording.id}`}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group block rounded-lg px-2 py-2 transition-colors",
                          active
                            ? "bg-sidebar-accent text-sidebar-accent-foreground"
                            : "hover:bg-sidebar-accent/65"
                        )}
                      >
                        <span className="block truncate text-xs leading-4 font-medium">
                          {recording.title}
                        </span>
                        <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-sidebar-foreground/45">
                          <span>
                            {new Date(recording.createdAt).toLocaleDateString(
                              "en-GB",
                              {
                                day: "numeric",
                                month: "short",
                              }
                            )}
                          </span>
                          {recordingDuration && (
                            <span className="tabular-nums">
                              {recordingDuration}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-2 border-t border-sidebar-border pt-2">
          <div className="flex items-center gap-2 rounded-lg px-1.5 py-1">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sidebar-accent text-[10px] font-semibold">
              {initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium">{name}</span>
              <span className="block truncate text-[10px] text-sidebar-foreground/45">
                {email}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setTheme(darkTheme ? "light" : "dark")}
              aria-label={darkTheme ? "Use light theme" : "Use dark theme"}
              title={darkTheme ? "Use light theme" : "Use dark theme"}
              className="grid size-7 place-items-center rounded-lg text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {darkTheme ? (
                <RiSunLine className="size-3.5" />
              ) : (
                <RiMoonLine className="size-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Log out"
              title="Log out"
              className="grid size-7 place-items-center rounded-lg text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-50"
            >
              {signingOut ? (
                <RiLoader4Line className="size-3.5 animate-spin" />
              ) : (
                <RiLogoutBoxRLine className="size-3.5" />
              )}
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}
