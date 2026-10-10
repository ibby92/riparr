import { NextResponse, type NextRequest } from "next/server";
import { authMode, needsSetup, SESSION_COOKIE, verifyApiKey, verifySessionToken } from "@/lib/auth";

const PUBLIC_PAGES = ["/login", "/setup"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (authMode() === "none" || pathname === "/api/health") return NextResponse.next();

  const sessionUser = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/api/")) {
    const key = req.headers.get("x-api-key") ?? req.nextUrl.searchParams.get("apikey");
    if (sessionUser || verifyApiKey(key)) return NextResponse.next();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (needsSetup()) {
    return pathname === "/setup" ? NextResponse.next() : NextResponse.redirect(new URL("/setup", req.url));
  }
  // The account exists: setup has nothing to do.
  if (pathname === "/setup") return NextResponse.redirect(new URL(sessionUser ? "/" : "/login", req.url));
  if (PUBLIC_PAGES.includes(pathname)) {
    return sessionUser ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }
  if (sessionUser) return NextResponse.next();

  const login = new URL("/login", req.url);
  if (pathname !== "/") login.searchParams.set("next", pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  // Static files (icons, manifest) stay public so the login page and home-screen icons work signed out.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:svg|png|ico|webmanifest)$).*)"],
};
