import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.RIPARR_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "riparr-gfsalt-"));

// gofile's real wt.obf.js as fetched 2026-10-16.
const script = fs.readFileSync(path.join(__dirname, "../__fixtures__/gofile-wt.obf.js.txt"), "utf8");

let extractSalt: typeof import("./gofile-salt").extractSalt;
let saltFromInput: typeof import("./gofile-salt").saltFromInput;
let refreshGofileSalt: typeof import("./gofile-salt").refreshGofileSalt;
let currentSalt: typeof import("./gofile-salt").currentSalt;
let hostAccount: typeof import("@/lib/host-accounts").hostAccount;

beforeAll(async () => {
  ({ extractSalt, saltFromInput, refreshGofileSalt, currentSalt } = await import("./gofile-salt"));
  ({ hostAccount } = await import("@/lib/host-accounts"));
});
afterAll(() => fs.rmSync(process.env.RIPARR_CONFIG_DIR!, { recursive: true, force: true }));

describe("gofile salt refresh", () => {
  it("reads the salt out of the hashed string", () => {
    expect(saltFromInput("ua::en-US::riparr-probe-token::123::abc123def")).toBe("abc123def");
    expect(() => saltFromInput("ua::en-US::other::123::abc123def")).toThrow(/format changed/);
    expect(() => saltFromInput("ua::en-US::riparr-probe-token::123::x y")).toThrow(/format changed/);
  });

  it("extracts the salt from gofile's real script in the sandbox", async () => {
    expect(await extractSalt(script)).toBe("12af056dacea0b");
  });

  it("fails cleanly on a script it can't match, and on one that never returns", async () => {
    await expect(extractSalt("globalThis.generateWT = async () => 'abc';")).rejects.toThrow(/known scheme/);
    await expect(extractSalt("throw new Error('boom')")).rejects.toThrow(/boom/);
  });

  it("denies the script file, network and process access", async () => {
    await expect(extractSalt("require('node:fs').readFileSync('/etc/passwd')")).rejects.toThrow();
    await expect(extractSalt("process.binding('fs')")).rejects.toThrow();
  });

  it("stores a refreshed salt and hands it to the gofile resolver unless the account has its own", async () => {
    expect(currentSalt()).toBe("12af056dacea0b");
    expect(hostAccount("gofile")).toBeNull();
    // Only the failure path can run without gofile's real script; the stored salt is applied via settings.
    const bad = await refreshGofileSalt((async () => new Response("nope", { status: 503 })) as typeof fetch);
    expect(bad).toEqual({ ok: false, error: expect.stringContaining("503") });
    const { setSetting } = await import("@/lib/settings");
    setSetting("gofile.wt_salt", "newsalt1234");
    expect(currentSalt()).toBe("newsalt1234");
    expect(hostAccount("gofile")).toEqual({ wtSalt: "newsalt1234" });
  });
});
