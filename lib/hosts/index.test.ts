import { describe, expect, it } from "vitest";
import { findResolver, hostIdFor, normalizeLinkUrl, RESOLVERS } from "./index";

describe("findResolver / hostIdFor", () => {
  it("finds resolvers by link", () => {
    expect(RESOLVERS.map((r) => r.id)).toEqual(["pixeldrain", "gofile", "mega"]);
    expect(findResolver("https://pixeldrain.net/u/abc")?.id).toBe("pixeldrain");
    expect(findResolver(new URL("https://gofile.io/d/xyz"))?.id).toBe("gofile");
    expect(findResolver("https://mega.nz/#F!a!b")?.id).toBe("mega");
    expect(findResolver("https://rapidgator.net/file/1")).toBeNull();
    expect(findResolver("not a url")).toBeNull();
  });

  it("falls back to the bare hostname", () => {
    expect(hostIdFor("https://pixeldra.in/u/abc")).toBe("pixeldrain");
    expect(hostIdFor("https://www.Rapidgator.net/file/1")).toBe("rapidgator.net");
    expect(hostIdFor("garbage")).toBe("unknown");
  });
});

describe("normalizeLinkUrl", () => {
  it("canonicalises pixeldrain aliases", () => {
    expect(normalizeLinkUrl("http://www.PIXELDRA.IN/u/abc123/?utm_source=x#foo")).toBe("https://pixeldrain.com/u/abc123");
    expect(normalizeLinkUrl("https://pixeldrain.net/api/list/L1")).toBe("https://pixeldrain.com/l/L1");
  });

  it("canonicalises gofile", () => {
    expect(normalizeLinkUrl("https://www.gofile.io/d/AbC?fbclid=1")).toBe("https://gofile.io/d/AbC");
  });

  it("keeps the MEGA key and modernises legacy links", () => {
    expect(normalizeLinkUrl("https://mega.co.nz/#!Id!Key")).toBe("https://mega.nz/file/Id#Key");
    expect(normalizeLinkUrl("https://www.mega.nz/folder/F#K/file/S")).toBe("https://mega.nz/folder/F#K/file/S");
    expect(normalizeLinkUrl("https://mega.nz/#F!F!K")).toBe("https://mega.nz/folder/F#K");
  });

  it("drops tracking params and fragments on unknown hosts", () => {
    expect(normalizeLinkUrl("https://WWW.Example.com/f/1?utm_medium=a&id=2&gclid=z#top")).toBe("https://example.com/f/1?id=2");
    expect(normalizeLinkUrl("  not a url ")).toBe("not a url");
  });
});
