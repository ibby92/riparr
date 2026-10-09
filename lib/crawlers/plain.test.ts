import { describe, expect, it } from "vitest";
import { isKnownHostUrl } from "./known-hosts";
import { extractHostLinks, plainSource } from "./plain";

describe("isKnownHostUrl", () => {
  it("matches domains, aliases and subdomains but not homepages", () => {
    expect(isKnownHostUrl("https://gofile.io/d/abc")).toBe(true);
    expect(isKnownHostUrl("https://pixeldra.in/u/abc")).toBe(true);
    expect(isKnownHostUrl("https://www.mediafire.com/file/x/y")).toBe(true);
    expect(isKnownHostUrl("https://1fichier.com/?abc123")).toBe(true);
    expect(isKnownHostUrl("https://desfichiers.com/?abc123")).toBe(true);
    expect(isKnownHostUrl("https://gofile.io/")).toBe(false);
    expect(isKnownHostUrl("https://notgofile.io/d/abc")).toBe(false);
    expect(isKnownHostUrl("https://gofile.io.evil.com/d/abc")).toBe(false);
    expect(isKnownHostUrl("ftp://gofile.io/d/abc")).toBe(false);
  });
});

describe("extractHostLinks", () => {
  it("finds anchors and plain-text URLs in page order, deduplicated", () => {
    const html = `
      <nav><a href="https://rentry.co/">rentry</a> <a href="https://gofile.io/">gofile</a></nav>
      <a href="https://mega.nz/folder/AbC#k3y_x">Mega</a>
      <p>Mirror: https://pixeldrain.com/u/abc123. Also (https://buzzheavier.com/f/xyz) and
      https://1fichier.com/?q1w2e3&amp;af=1, plus https://krakenfiles.com/view/k1/file.html!</p>
      <a href='https://gofile.io/d/Zz9'>x</a><a href=https://mega.nz/folder/AbC#k3y_x>dupe</a>
      <a href="https:&#x2F;&#x2F;www.mediafire.com&#x2F;file&#x2F;abc&#x2F;a.zip&#x2F;file">mf</a>
      <script>var data = {"url":"https:\\/\\/rapidgator.net\\/file\\/abc"};</script>`;
    expect(extractHostLinks(html, "https://rentry.co/x")).toEqual([
      "https://mega.nz/folder/AbC#k3y_x",
      "https://pixeldrain.com/u/abc123",
      "https://buzzheavier.com/f/xyz",
      "https://1fichier.com/?q1w2e3&af=1",
      "https://krakenfiles.com/view/k1/file.html",
      "https://gofile.io/d/Zz9",
      "https://www.mediafire.com/file/abc/a.zip/file",
      "https://rapidgator.net/file/abc",
    ]);
  });

  it("keeps balanced parentheses", () => {
    expect(extractHostLinks("see https://mega.nz/file/a_(1)", "https://x/")).toEqual(["https://mega.nz/file/a_(1)"]);
  });

  it("returns null via the source when nothing matches", async () => {
    const opts = { password: null, signal: new AbortController().signal };
    expect(await plainSource.crawl("https://x/", "<a href='https://example.com/a'>a</a>", opts)).toBeNull();
  });
});
