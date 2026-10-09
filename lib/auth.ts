import crypto from "node:crypto";
import { getSetting, setSetting } from "./settings";

export const SESSION_COOKIE = "riparr_session";
export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

const KEYS = {
  mode: "auth.mode",
  username: "auth.username",
  passwordHash: "auth.password_hash",
  version: "auth.version",
  secret: "auth.secret",
  apiKey: "api.key",
} as const;

export type AuthMode = "forms" | "none";

/** `RIPARR_AUTH=none` is an escape hatch for a forgotten password. */
export function authMode(): AuthMode {
  if (process.env.RIPARR_AUTH === "none") return "none";
  return getSetting(KEYS.mode) === "none" ? "none" : "forms";
}

export function setAuthMode(mode: AuthMode) {
  setSetting(KEYS.mode, mode);
}

/** True until the first user has been created (and auth is on). */
export function needsSetup(): boolean {
  return authMode() === "forms" && !getSetting(KEYS.username);
}

export function currentUsername(): string | null {
  return getSetting(KEYS.username) ?? null;
}

function randomHex(bytes: number) {
  return crypto.randomBytes(bytes).toString("hex");
}

function getOrCreate(key: string, make: () => string) {
  const existing = getSetting(key);
  if (existing) return existing;
  const value = make();
  setSetting(key, value);
  return value;
}

export function apiKey(): string {
  return getOrCreate(KEYS.apiKey, () => randomHex(16));
}

export function regenerateApiKey(): string {
  const key = randomHex(16);
  setSetting(KEYS.apiKey, key);
  return key;
}

function hashPassword(password: string, salt = randomHex(16)) {
  const hash = crypto.scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Sets the login. Bumping the version signs out every existing session. */
export function setCredentials(username: string, password: string) {
  setSetting(KEYS.username, username);
  setSetting(KEYS.passwordHash, hashPassword(password));
  setSetting(KEYS.version, String(Number(getSetting(KEYS.version) ?? 0) + 1));
}

export function checkCredentials(username: string, password: string): boolean {
  const stored = getSetting(KEYS.passwordHash);
  const user = getSetting(KEYS.username);
  if (!stored || !user) return false;
  const [, salt, hash] = stored.split(":");
  // Always hash, so a wrong username takes as long as a wrong password.
  const candidate = hashPassword(password, salt).split(":")[2];
  return safeEqual(candidate, hash) && safeEqual(username.toLowerCase(), user.toLowerCase());
}

function sign(payload: string) {
  const secret = getOrCreate(KEYS.secret, () => randomHex(32));
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createSessionToken(username: string, now = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: now + SESSION_MAX_AGE_S * 1000, v: getSetting(KEYS.version) ?? "0" }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Username for a valid, unexpired session token from the current credential version, else null. */
export function verifySessionToken(token: string | undefined, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(sign(payload), signature)) return null;
  try {
    const { u, exp, v } = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; exp: number; v: string };
    if (exp < now || v !== (getSetting(KEYS.version) ?? "0")) return null;
    return u;
  } catch {
    return null;
  }
}

export function verifyApiKey(candidate: string | null | undefined): boolean {
  return Boolean(candidate) && safeEqual(candidate!, apiKey());
}

// Simple in-memory login throttle: 10 failures per IP per 15 minutes.
const failures = new Map<string, { count: number; until: number }>();
const WINDOW_MS = 15 * 60_000;

export function loginBlocked(ip: string, now = Date.now()): boolean {
  const entry = failures.get(ip);
  return Boolean(entry && entry.until > now && entry.count >= 10);
}

export function recordLoginFailure(ip: string, now = Date.now()) {
  const entry = failures.get(ip);
  if (!entry || entry.until <= now) failures.set(ip, { count: 1, until: now + WINDOW_MS });
  else entry.count++;
}

export function clearLoginFailures(ip: string) {
  failures.delete(ip);
}
