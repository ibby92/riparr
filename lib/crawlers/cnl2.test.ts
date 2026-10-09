import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cnl2Source, decryptCnl2, evaluateJk, findCnl2Payloads } from "./cnl2";

const KEY_HEX = "31323334353637383930616263646566";
const LINKS = ["https://gofile.io/d/AbC123", "https://pixeldrain.com/u/xyz789", "https://mega.nz/file/abc#key-1"];

function encrypt(links: string[], keyHex = KEY_HEX, sep = "\r\n") {
  const key = Buffer.from(keyHex, "hex");
  let data = Buffer.from(links.join(sep), "utf8");
  data = Buffer.concat([data, Buffer.alloc((16 - (data.length % 16)) % 16)]); // NUL padding, as CNL senders do
  const cipher = createCipheriv("aes-128-cbc", key, key);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("base64");
}

const jkFn = (hex = KEY_HEX) => `function f(){ return '${hex}'; }`;

describe("decryptCnl2", () => {
  it("round-trips links with a trivial jk", () => {
    expect(decryptCnl2(jkFn(), encrypt(LINKS))).toEqual(LINKS);
  });

  it("accepts LF separators and a bare hex key", () => {
    expect(decryptCnl2(KEY_HEX, encrypt(LINKS, KEY_HEX, "\n"))).toEqual(LINKS);
  });

  it("evaluates non-trivial jk scripts in the sandbox", () => {
    const jk = "function f(){ var a = '3132333435363738'; return a + ['3930', '6162', '6364', '6566'].join(''); }";
    expect(decryptCnl2(jk, encrypt(LINKS))).toEqual(LINKS);
  });

  it("tolerates spaces where '+' was form-decoded", () => {
    const crypted = encrypt(LINKS);
    expect(decryptCnl2(jkFn(), crypted.replace(/\+/g, " "))).toEqual(LINKS);
  });

  it("rejects bad keys and hostile scripts", () => {
    expect(() => evaluateJk("function f(){ return 'nothex'; }")).toThrow(/hex key/);
    expect(() => evaluateJk("function f(){ while(true){} }")).toThrow(/failed/);
    expect(() => evaluateJk("function f(){ return process.env.HOME; }")).toThrow(/failed/);
    expect(() => evaluateJk("function f(){ return require('fs'); }")).toThrow(/failed/);
    expect(() => evaluateJk("function f(){ return eval('1'); }")).toThrow(/failed/);
    expect(() => evaluateJk("function f(){ return { toString(){ while(true){} } }; }")).toThrow(/hex key/);
    expect(() => decryptCnl2(jkFn(), "AAAA")).toThrow(/AES/);
  });
});

describe("findCnl2Payloads / cnl2Source", () => {
  it("reads hidden-input forms, including several mirrors", async () => {
    const mirror2 = ["https://1fichier.com/?abc123", LINKS[0]];
    const html = `
      <form action="http://127.0.0.1:9666/flash/addcrypted2" method="POST" target="hidden">
        <input type="hidden" name="passwords" value="">
        <input type="hidden" name="source" value="https://example.com/">
        <input type="hidden" name="jk" value="function f(){ return &#39;${KEY_HEX}&#39;;}">
        <input type="hidden" name="crypted" value="${encrypt(LINKS)}">
        <input type="submit" name="submit" value="Click'n'Load">
      </form>
      <form action='http://127.0.0.1:9666/flash/addcrypted2' method='post'>
        <input type=hidden name=jk value="${jkFn().replace(/'/g, "&#x27;")}" />
        <input type=hidden name=crypted value="${encrypt(mirror2)}" />
      </form>`;
    expect(findCnl2Payloads(html)).toHaveLength(2);
    expect(await cnl2Source.crawl("https://example.com/", html, opts())).toEqual({
      links: [...LINKS, mirror2[0]],
      source: "cnl2",
    });
  });

  it("reads filecrypt-style CNLPOP calls", async () => {
    const html = `<form onsubmit="CNLPOP('cnl1', '${KEY_HEX}', '${encrypt(LINKS)}', '');return false;"><button>CNL</button></form>`;
    expect((await cnl2Source.crawl("https://x/", html, opts()))?.links).toEqual(LINKS);
  });

  it("reads inline JS object literals and assignments", async () => {
    const html = `<script>
      $('#cnl').click(function () {
        $.post("http://127.0.0.1:9666/flash/addcrypted2", {
          "passwords": "",
          "source": location.href,
          "jk": "function f(){ return \\'${KEY_HEX}\\'; }",
          "crypted": "${encrypt(LINKS)}"
        });
      });
    </script>`;
    expect((await cnl2Source.crawl("https://x/", html, opts()))?.links).toEqual(LINKS);

    const vars = `<script>var jk = '${KEY_HEX}'; var crypted = '${encrypt(LINKS.slice(1))}';</script>`;
    expect((await cnl2Source.crawl("https://x/", vars, opts()))?.links).toEqual(LINKS.slice(1));
  });

  it("reads url-encoded request bodies", async () => {
    const body = `passwords=&source=x&jk=${encodeURIComponent(jkFn())}&crypted=${encodeURIComponent(encrypt(LINKS))}`;
    const html = `<script>fetch("http://127.0.0.1:9666/flash/addcrypted2", { method: "POST", body: "${body}" });</script>`;
    expect((await cnl2Source.crawl("https://x/", html, opts()))?.links).toEqual(LINKS);
  });

  it("returns null for pages without CNL data", async () => {
    expect(await cnl2Source.crawl("https://x/", "<p>https://gofile.io/d/abc</p>", opts())).toBeNull();
  });
});

function opts() {
  return { password: null, signal: new AbortController().signal };
}
