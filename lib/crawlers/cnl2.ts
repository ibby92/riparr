import { createDecipheriv } from "node:crypto";
import vm from "node:vm";
import { decodeEntities, parseAttrs, unescapeJs } from "./html";
import type { ContainerSource } from "./types";

/** One Click'n'Load v2 payload as it would be POSTed to 127.0.0.1:9666/flash/addcrypted2. */
export type Cnl2Payload = { jk: string; crypted: string; passwords?: string; source?: string };

const HEX_KEY = /^[0-9a-f]{32}$/i;
const TRIVIAL_JK = /^\s*function\s+f\s*\(\s*\)\s*\{\s*return\s*(["'])([0-9a-f]{32})\1\s*;?\s*\}\s*;?\s*$/i;

/**
 * Hex key from a `jk` value: either a bare hex key (filecrypt's CNLPOP) or a JS
 * snippet defining `f()` that returns one. Non-trivial snippets run in an empty
 * vm context with a 50ms budget and no string codegen.
 */
export function evaluateJk(jk: string): string {
  const s = jk.trim();
  if (HEX_KEY.test(s)) return s;
  const trivial = TRIVIAL_JK.exec(s);
  if (trivial) return trivial[2];
  if (s.length > 20_000) throw new Error("CNL key script is too large");

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: "afterEvaluate",
  });
  let result: unknown;
  try {
    result = vm.runInContext(`${s}\n;typeof f === "function" ? f() : undefined`, context, { timeout: 50 });
  } catch (err) {
    throw new Error(`CNL key script failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Only accept a primitive string: coercing an object could run its toString outside the timeout.
  if (typeof result !== "string" || !HEX_KEY.test(result.trim())) {
    throw new Error("CNL key script did not return a 128-bit hex key");
  }
  return result.trim();
}

/** Decrypts a CNL2 payload into its links (AES-128-CBC, key = IV = hex-decoded f()). */
export function decryptCnl2(jk: string, crypted: string): string[] {
  const key = Buffer.from(evaluateJk(jk), "hex");
  // Form-decoded base64 sometimes loses its "+" to spaces.
  const data = Buffer.from(crypted.trim().replace(/ /g, "+").replace(/\s+/g, ""), "base64");
  if (data.length === 0 || data.length % 16 !== 0) throw new Error("CNL payload is not valid AES data");
  const decipher = createDecipheriv("aes-128-cbc", key, key);
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  return plain
    .replace(/\0+$/, "")
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(line));
}

type Found = { pos: number; value: string };

const jsString = String.raw`(["'\x60])((?:\\[\s\S]|(?!\1)[^\\])*)\1`;
// `jk: "…"`, `"jk": '…'`, `jk = '…'`, `formData.append("jk", "…")`
const jsField = (name: string) =>
  new RegExp(String.raw`(?:\b${name}["']?\s*[:=]|["']${name}["']\s*,)\s*` + jsString, "g");
// `…&jk=…&crypted=…` request bodies
const urlField = (name: string) => new RegExp(String.raw`[?&]${name}=([^&"\s<>]+)`, "g");

function fieldsInScript(text: string, name: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(jsField(name))) found.push({ pos: m.index, value: unescapeJs(m[2]) });
  for (const m of text.matchAll(urlField(name))) {
    try {
      found.push({ pos: m.index, value: decodeURIComponent(m[1].replace(/\+/g, "%20")) });
    } catch {
      // malformed escape; ignore
    }
  }
  return found;
}

/** All CNL2 payloads on a page: hidden-input forms, filecrypt's CNLPOP(), and inline-JS posts. */
export function findCnl2Payloads(html: string): Cnl2Payload[] {
  const payloads: Cnl2Payload[] = [];
  let rest = html;

  for (const form of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)) {
    const fields: Record<string, string> = {};
    for (const input of form[0].matchAll(/<(?:input|button)\b[^>]*>/gi)) {
      const attrs = parseAttrs(input[0]);
      if (attrs.name) fields[attrs.name.toLowerCase()] = attrs.value ?? "";
    }
    for (const ta of form[0].matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea\s*>/gi)) {
      const attrs = parseAttrs(`<textarea ${ta[1]}>`);
      if (attrs.name) fields[attrs.name.toLowerCase()] = decodeEntities(ta[2]);
    }
    if (fields.jk && fields.crypted) {
      payloads.push({ jk: fields.jk, crypted: fields.crypted, passwords: fields.passwords, source: fields.source });
      rest = rest.replace(form[0], "");
    }
  }

  // filecrypt-style: CNLPOP('<id>', '<hex key>', '<crypted>', '<…>')
  const script = decodeEntities(rest);
  const cnlpop = /CNLPOP\(([^)]*)\)/g;
  for (const call of script.matchAll(cnlpop)) {
    const args = [...call[1].matchAll(new RegExp(jsString, "g"))].map((m) => unescapeJs(m[2]));
    if (args.length >= 3) payloads.push({ jk: args[1], crypted: args[2] });
  }

  // Inline JS: pair every `crypted` with the nearest `jk`.
  const jsText = script.replace(cnlpop, "");
  const jks = fieldsInScript(jsText, "jk");
  if (jks.length) {
    for (const c of fieldsInScript(jsText, "crypted")) {
      const jk = jks.reduce((a, b) => (Math.abs(b.pos - c.pos) < Math.abs(a.pos - c.pos) ? b : a));
      payloads.push({ jk: jk.value, crypted: c.value });
    }
  }

  const seen = new Set<string>();
  return payloads.filter((p) => {
    const k = `${p.jk}\n${p.crypted}`;
    return p.jk && p.crypted && !seen.has(k) && seen.add(k);
  });
}

export const cnl2Source: ContainerSource = {
  name: "cnl2",
  async crawl(_url, html) {
    const links = new Set<string>();
    for (const p of findCnl2Payloads(html)) {
      try {
        for (const link of decryptCnl2(p.jk, p.crypted)) links.add(link);
      } catch {
        // A broken mirror shouldn't hide the others; crawlContainer reports if none decrypt.
      }
    }
    return links.size ? { links: [...links], source: "cnl2" } : null;
  },
};
