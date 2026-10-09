// Test helper: builds an mkvdrama-style page + encrypted API response, like the real site.
import crypto from "node:crypto";
import type { CrateLink } from "./crate-api";

const xorPair = (bytes: Buffer) => {
  const mask = [...crypto.randomBytes(bytes.length)];
  return JSON.stringify([[...bytes].map((b, i) => b ^ mask[i]), mask]).replace(/"/g, "&quot;");
};

export function makeCrateSite(containerId: string) {
  const key = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const token = crypto.randomBytes(12).toString("hex");
  const page = `<html><head><title>Crate</title></head><body>
    <div id="w" data-s="${containerId}" data-p="c"></div>
    <div id="xd" data-n="${xorPair(Buffer.from(token))}" data-k="${xorPair(key)}" data-v="${xorPair(iv)}" data-pfx="x1" style="display:none"></div>
    <script>(function(){ /* the real site's loader would run here */ })();</script></body></html>`;
  const apiPath = `/c/${containerId}/p/${token}`;
  const apiBody = (title: string, links: CrateLink[]) => {
    const c = crypto.createCipheriv("aes-128-gcm", key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify({ title, link_count: links.length, links, filters: {} })), c.final(), c.getAuthTag()]);
    return JSON.stringify({ d: ct.toString("base64") });
  };
  return { page, apiPath, apiBody, key, iv };
}
