import { describe, expect, it } from "vitest";
import { siteHint } from "./site-hints";

describe("siteHint", () => {
  it("notes the quirks of filecrypt and mkvdrama's temporary links, and nothing else", () => {
    expect(siteHint("https://www.filecrypt.cc/Container/2B9C3624AD.html")).toMatch(/captcha.*Click'n'Load/);
    expect(siteHint("https://filecrypt.co/Container/X.html")).toMatch(/captcha/);
    expect(siteHint("https://mkvdrama.net/c/xAQAAA")).toMatch(/expire/);
    expect(siteHint("https://mkvdrama.net/between-steps-24gvdj62")).toBeNull();
    expect(siteHint("https://viewcrate.cc/c/abc")).toBeNull();
    expect(siteHint("not a url")).toBeNull();
  });
});
