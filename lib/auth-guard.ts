import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/auth";

/**
 * Server-side session guard for Server Components.
 * Validates the session against the Better Auth DB (not just cookie presence).
 * Redirects to /login if no valid session exists.
 */
export async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");
  return session;
}
