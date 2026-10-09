/** Small regex-based HTML helpers. Container pages are scraped, not rendered. */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  sol: "/",
  colon: ":",
  quest: "?",
  equals: "=",
  num: "#",
  percnt: "%",
  plus: "+",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));?/gi, (m, dec, hex, name) => {
    if (dec || hex) {
      const code = parseInt(dec ?? hex, dec ? 10 : 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[name.toLowerCase()] ?? m;
  });
}

/** Attributes of a single tag (`<input name="x" value='y' disabled>`), names lowercased, values decoded. */
export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const inner = tag.replace(/^<\s*[\w-]+/, "").replace(/\/?>$/, "");
  for (const m of inner.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** Contents of a JS string literal (without quotes) with escapes resolved. */
export function unescapeJs(s: string): string {
  return s.replace(/\\(?:x([0-9a-f]{2})|u\{([0-9a-f]+)\}|u([0-9a-f]{4})|([\s\S]))/gi, (_, x, ub, u, c) => {
    if (x || ub || u) return String.fromCodePoint(parseInt(x ?? ub ?? u, 16));
    return ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", "0": "\0" } as Record<string, string>)[c] ?? c;
  });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
