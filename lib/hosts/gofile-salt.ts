import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { getSetting, setSetting } from "@/lib/settings";
import { logEvent } from "@/lib/events";
import { fetchFor } from "@/lib/net";
import { GOFILE_SALT_KEY } from "@/lib/host-accounts";
import { GOFILE_WT_SALT, GOFILE_WT_SCRIPT_URL } from "./gofile";

/*
 * gofile rotates the secret in its website-token script (wt.obf.js) now and then. Rather than
 * reading the obfuscated source, we run the script and watch what it hashes:
 *
 *   - in a child process under Node's permission model (`--permission` with nothing granted: no
 *     file system, network, child processes or workers), on top of a bare `vm` context, with a
 *     timeout and capped output;
 *   - the child hands the script a probe token, records the string it hashes
 *     (`<ua>::<lang>::<token>::<slot>::<salt>`), and only reports the salt when the script's own
 *     result equals sha256 of that string.
 *
 * If gofile changes the scheme, the check fails and nothing is stored.
 */

const AUTO_KEY = "gofile.wt_auto";
const ATTEMPT_KEY = "gofile.wt_attempt_at";
const REFRESHED_KEY = "gofile.wt_refreshed_at";
const AUTO_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const MAX_SCRIPT_BYTES = 2 * 1024 * 1024;
const CHILD_TIMEOUT_MS = 15_000;
const PROBE_TOKEN = "riparr-probe-token";

const CHILD = String.raw`
const vm = require("node:vm");
const { createHash } = require("node:crypto");
let src = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (src += d));
process.stdin.on("end", async () => {
  try {
    const captured = [];
    const sb = {
      navigator: { userAgent: "riparr-probe-ua", language: "en-US", languages: ["en-US"] },
      TextEncoder, TextDecoder, setTimeout, clearTimeout,
    };
    sb.window = sb; sb.self = sb; sb.globalThis = sb;
    sb.document = {}; sb.location = { href: "https://gofile.io/" };
    sb.__rec = (s) => { if (typeof s === "string" && s.includes(${JSON.stringify(PROBE_TOKEN)})) captured.push(s); };
    vm.createContext(sb);
    vm.runInContext(
      "const __cca = String.prototype.charCodeAt, __cpa = String.prototype.codePointAt, __enc = TextEncoder.prototype.encode;" +
      "String.prototype.charCodeAt = function (i) { __rec(String(this)); return __cca.call(this, i); };" +
      "String.prototype.codePointAt = function (i) { __rec(String(this)); return __cpa.call(this, i); };" +
      "TextEncoder.prototype.encode = function (s) { __rec(String(s)); return __enc.call(this, s); };",
      sb, { timeout: 2000 });
    vm.runInContext(src, sb, { timeout: 5000 });
    const out = await Promise.race([
      Promise.resolve(sb.generateWT(${JSON.stringify(PROBE_TOKEN)})),
      new Promise((_, rej) => setTimeout(() => rej(new Error("generateWT timed out")), 5000)),
    ]);
    const input = captured.find((s) => createHash("sha256").update(s).digest("hex") === out);
    if (!input) throw new Error("could not match the script's token to a known scheme");
    process.stdout.write(JSON.stringify({ input }));
    process.exit(0);
  } catch (e) {
    process.stderr.write(String((e && e.message) || e).slice(0, 300));
    process.exit(1);
  }
});
`;

/** Pulls the salt out of the hashed string `<ua>::<lang>::<token>::<slot>::<salt>`. */
export function saltFromInput(input: string): string {
  const parts = input.split("::");
  const salt = parts[parts.length - 1];
  if (parts.length !== 5 || parts[2] !== PROBE_TOKEN || !/^[\w.-]{4,64}$/.test(salt)) {
    throw new Error("the script's token format changed");
  }
  return salt;
}

/** Runs gofile's script in the sandbox and returns the salt it uses. */
export function extractSalt(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child: ChildProcessByStdio<Writable, Readable, Readable> = spawn(
      process.execPath,
      ["--permission", "--max-old-space-size=128", "-e", CHILD],
      { stdio: ["pipe", "pipe", "pipe"], env: {} as NodeJS.ProcessEnv, timeout: CHILD_TIMEOUT_MS, killSignal: "SIGKILL" },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout = (stdout + d).slice(0, 64 * 1024)));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(0, 2000)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(stderr.trim() || `sandbox exited with ${code}`));
      try {
        resolve(saltFromInput((JSON.parse(stdout) as { input: string }).input));
      } catch (e) {
        reject(e);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(script);
  });
}

export type SaltRefresh = { ok: true; salt: string; changed: boolean } | { ok: false; error: string };

/** The salt currently in effect when no account overrides it. */
export function currentSalt(): string {
  return getSetting(GOFILE_SALT_KEY) || GOFILE_WT_SALT;
}

export function gofileAutoRefresh(): boolean {
  return getSetting(AUTO_KEY) === "1";
}

export function setGofileAutoRefresh(on: boolean) {
  setSetting(AUTO_KEY, on ? "1" : "0");
}

export function lastSaltRefresh(): number | null {
  const v = getSetting(REFRESHED_KEY);
  return v ? Number(v) : null;
}

let inFlight: Promise<SaltRefresh> | null = null;

/** Downloads gofile's script, extracts the current salt and stores it. Concurrent calls share one run. */
export function refreshGofileSalt(fetchImpl: typeof fetch = fetchFor("host")): Promise<SaltRefresh> {
  inFlight ??= (async (): Promise<SaltRefresh> => {
    setSetting(ATTEMPT_KEY, String(Date.now()));
    try {
      const res = await fetchImpl(GOFILE_WT_SCRIPT_URL, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`gofile returned HTTP ${res.status} for its token script`);
      const script = await res.text();
      if (script.length > MAX_SCRIPT_BYTES) throw new Error("token script is unexpectedly large");
      const salt = await extractSalt(script);
      const before = currentSalt();
      setSetting(GOFILE_SALT_KEY, salt);
      setSetting(REFRESHED_KEY, String(Date.now()));
      const changed = salt !== before;
      logEvent("info", changed ? "gofile website-token salt refreshed (it changed)" : "gofile website-token salt checked (unchanged)", null, "host");
      return { ok: true, salt, changed };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      logEvent("warn", `Couldn't refresh the gofile website-token salt: ${error}`, null, "host");
      return { ok: false, error };
    }
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/**
 * Called when gofile rejects even a fresh guest: if auto-refresh is on (and hasn't just tried),
 * fetches the salt. Returns true when the salt changed, i.e. a retry is worthwhile.
 */
export async function autoRefreshSalt(now = Date.now()): Promise<boolean> {
  if (!gofileAutoRefresh()) return false;
  const last = Number(getSetting(ATTEMPT_KEY) ?? 0);
  if (now - last < AUTO_COOLDOWN_MS) return false;
  const result = await refreshGofileSalt();
  return result.ok && result.changed;
}
