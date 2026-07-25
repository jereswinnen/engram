import { Geist, Geist_Mono } from "next/font/google"
import { headers } from "next/headers"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AppHeader } from "@/components/app-header"
import { auth } from "@/auth"
import { cn } from "@/lib/utils"
import { listOwnedRecordings } from "@/lib/recordings/store"

const fontSans = Geist({ subsets: ["latin"], variable: "--font-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

function initials(name?: string | null, email?: string | null) {
  const value = name?.trim() || email?.split("@")[0] || "Me"
  return value
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const session = await auth.api.getSession({ headers: await headers() })
  const recentRecordings = session
    ? (await listOwnedRecordings(session.user.id))
        .slice(0, 12)
        .map((recording) => ({
          id: recording.id,
          title: recording.title,
          createdAt: recording.createdAt.toISOString(),
          durationSeconds: recording.durationSeconds,
        }))
    : []

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        fontSans.variable
      )}
    >
      <body>
        <ThemeProvider>
          {session && (
            <AppHeader
              initials={initials(session.user.name, session.user.email)}
              name={session.user.name ?? session.user.email}
              email={session.user.email}
              recentRecordings={recentRecordings}
            />
          )}
          <div className={cn("min-h-screen", session && "lg:pl-64")}>
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
