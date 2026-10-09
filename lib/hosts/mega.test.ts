import { describe, expect, it } from "vitest";
import { HostOfflineError, NeedsAttentionError, RateLimitError } from "@/lib/errors";
import { mapMegaError, mega, parseMegaUrl } from "./mega";

const p = (u: string) => parseMegaUrl(new URL(u));

describe("parseMegaUrl", () => {
  it("parses modern file and folder links", () => {
    expect(p("https://mega.nz/file/AbC-_1#KeY_-9")).toEqual({ kind: "file", id: "AbC-_1", key: "KeY_-9", sub: null, subKind: null });
    expect(p("https://mega.nz/folder/F1#K1")).toEqual({ kind: "folder", id: "F1", key: "K1", sub: null, subKind: null });
    expect(p("https://mega.nz/folder/F1#K1/file/S1")).toEqual({ kind: "folder", id: "F1", key: "K1", sub: "S1", subKind: "file" });
    expect(p("https://mega.nz/folder/F1#K1/folder/S2")).toEqual({ kind: "folder", id: "F1", key: "K1", sub: "S2", subKind: "folder" });
    expect(p("https://mega.nz/embed/E1#K")).toMatchObject({ kind: "file", id: "E1", key: "K" });
  });

  it("parses legacy links", () => {
    expect(p("https://mega.nz/#!Id1!Key1")).toEqual({ kind: "file", id: "Id1", key: "Key1", sub: null, subKind: null });
    expect(p("https://mega.co.nz/#F!Fold!FKey")).toEqual({ kind: "folder", id: "Fold", key: "FKey", sub: null, subKind: null });
    expect(p("https://mega.nz/#F!Fold!FKey!Sub")).toMatchObject({ kind: "folder", sub: "Sub" });
  });

  it("allows a missing key but rejects other pages", () => {
    expect(p("https://mega.nz/file/AbC")).toMatchObject({ id: "AbC", key: null });
    expect(p("https://mega.nz/")).toBeNull();
    expect(p("https://mega.nz/pro")).toBeNull();
    expect(p("https://example.com/file/AbC#k")).toBeNull();
  });

  it("matches via the resolver", () => {
    expect(mega.matches(new URL("https://www.mega.nz/file/x#y"))).toBe(true);
    expect(mega.matches(new URL("https://mega.nz/help"))).toBe(false);
  });

  it("needs attention when the key is missing", async () => {
    await expect(
      mega.resolve(new URL("https://mega.nz/file/AbC"), { account: null, password: null, signal: new AbortController().signal }),
    ).rejects.toBeInstanceOf(NeedsAttentionError);
  });
});

describe("mapMegaError", () => {
  it("maps API codes and bandwidth limits", () => {
    expect(mapMegaError(new Error("ENOENT (-9): Object (typically, node or user) not found. Wrong password?"))).toBeInstanceOf(HostOfflineError);
    expect(mapMegaError(new Error("EBLOCKED (-16): User blocked"))).toBeInstanceOf(HostOfflineError);
    expect(mapMegaError(new Error("EOVERQUOTA (-17): Request over quota"))).toBeInstanceOf(RateLimitError);
    const bw = Object.assign(new Error("Bandwidth limit reached: 1800 seconds until it resets"), { timeLimit: "1800" });
    const mapped = mapMegaError(bw) as RateLimitError;
    expect(mapped).toBeInstanceOf(RateLimitError);
    expect(mapped.retryAfterMs).toBe(1_800_000);
    expect(mapMegaError(new Error("Attributes could not be decrypted with provided key."))).toBeInstanceOf(NeedsAttentionError);
    expect(mapMegaError(new Error("boom")).constructor).toBe(Error);
  });
});
