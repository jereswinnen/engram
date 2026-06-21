import { Geist_Mono, DM_Sans } from "next/font/google"
import Link from "next/link"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { LogoutButton } from "@/components/logout-button"
import { cn } from "@/lib/utils";

const dmSans = DM_Sans({subsets:['latin'],variable:'--font-sans'})

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="nl"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans", dmSans.variable)}
    >
      <body>
        <ThemeProvider>
          <header className="border-b border-border/50 px-4 py-3 flex items-center gap-4">
            <Link href="/" className="font-semibold text-sm">
              Engram
            </Link>
            <Link
              href="/upload"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Uploaden
            </Link>
            <div className="ml-auto">
              <LogoutButton />
            </div>
          </header>
          <main>
            {children}
          </main>
        </ThemeProvider>
      </body>
    </html>
  )
}
