import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { authMode, createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S, verifySessionToken } from "./auth";

/**
 * Guard for every Server Action and request-time data read: Server Actions are
 * reachable by direct POST, so the proxy's check alone isn't enough.
 */
export async function requireSession(): Promise<string> {
  if (authMode() === "none") return "anonymous";
  const user = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!user) redirect("/login");
  return user;
}

export async function startSession(username: string) {
  const h = await headers();
  const secure = h.get("x-forwarded-proto") === "https";
  (await cookies()).set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Best-effort client IP for login throttling (honours a reverse proxy's X-Forwarded-For). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}
