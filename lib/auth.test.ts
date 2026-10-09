import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-auth-"));
process.env.RIPARR_CONFIG_DIR = tmp;

const auth = await import("./auth");
const { closeDb } = await import("./db");

afterAll(() => {
  closeDb();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("auth", () => {
  beforeAll(() => {
    delete process.env.RIPARR_AUTH;
  });

  it("needs setup until a user exists", () => {
    expect(auth.authMode()).toBe("forms");
    expect(auth.needsSetup()).toBe(true);
    auth.setCredentials("Admin", "correct horse");
    expect(auth.needsSetup()).toBe(false);
  });

  it("checks credentials (username case-insensitive)", () => {
    expect(auth.checkCredentials("admin", "correct horse")).toBe(true);
    expect(auth.checkCredentials("admin", "wrong")).toBe(false);
    expect(auth.checkCredentials("someone", "correct horse")).toBe(false);
  });

  it("issues sessions that expire, reject tampering, and die on password change", () => {
    const token = auth.createSessionToken("Admin");
    expect(auth.verifySessionToken(token)).toBe("Admin");
    expect(auth.verifySessionToken(token, Date.now() + auth.SESSION_MAX_AGE_S * 1000 + 1)).toBeNull();

    const [payload, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "Admin", exp: Date.now() * 2, v: "1" })).toString("base64url");
    expect(auth.verifySessionToken(`${forged}.${sig}`)).toBeNull();
    expect(auth.verifySessionToken(`${payload}.`)).toBeNull();
    expect(auth.verifySessionToken("garbage")).toBeNull();
    expect(auth.verifySessionToken(undefined)).toBeNull();

    auth.setCredentials("Admin", "new password!");
    expect(auth.verifySessionToken(token)).toBeNull();
    expect(auth.verifySessionToken(auth.createSessionToken("Admin"))).toBe("Admin");
  });

  it("manages the API key", () => {
    const key = auth.apiKey();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(auth.apiKey()).toBe(key);
    expect(auth.verifyApiKey(key)).toBe(true);
    expect(auth.verifyApiKey("nope")).toBe(false);
    expect(auth.verifyApiKey(null)).toBe(false);
    const next = auth.regenerateApiKey();
    expect(auth.verifyApiKey(key)).toBe(false);
    expect(auth.verifyApiKey(next)).toBe(true);
  });

  it("throttles repeated login failures per IP", () => {
    const now = 1_000_000;
    for (let i = 0; i < 10; i++) auth.recordLoginFailure("1.2.3.4", now);
    expect(auth.loginBlocked("1.2.3.4", now)).toBe(true);
    expect(auth.loginBlocked("5.6.7.8", now)).toBe(false);
    expect(auth.loginBlocked("1.2.3.4", now + 16 * 60_000)).toBe(false);
  });

  it("honours the RIPARR_AUTH=none escape hatch and the stored mode", () => {
    process.env.RIPARR_AUTH = "none";
    expect(auth.authMode()).toBe("none");
    expect(auth.needsSetup()).toBe(false);
    delete process.env.RIPARR_AUTH;
    auth.setAuthMode("none");
    expect(auth.authMode()).toBe("none");
    auth.setAuthMode("forms");
    expect(auth.authMode()).toBe("forms");
  });
});
