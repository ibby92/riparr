// Test helper: builds genuine DLC containers (only JDownloader's service step is faked by tests).
import crypto from "node:crypto";

const APP_KEY = Buffer.from("cb99b5cbc24db398");
const APP_IV = Buffer.from("9bc24cb995cb8db3");
const b64 = (s: string) => Buffer.from(s).toString("base64");

function aesEncrypt(key: Buffer, iv: Buffer, data: Buffer) {
  const padded = Buffer.concat([data, Buffer.alloc((16 - (data.length % 16)) % 16)]);
  const c = crypto.createCipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  return Buffer.concat([c.update(padded), c.final()]);
}

/** Builds a real DLC file plus the `<rc>` JDownloader's service would return for it. */
export function makeDlc(packages: { name: string; links: string[] }[]) {
  const key = crypto.randomBytes(16);
  const xml = `<dlc><header><generator><app>${b64("Test")}</app></generator></header><content>${packages
    .map(
      (p) =>
        `<package name="${b64(p.name)}">${p.links.map((l) => `<file><url>${b64(l)}</url><filename></filename></file>`).join("")}</package>`,
    )
    .join("")}</content></dlc>`;
  const payload = aesEncrypt(key, key, Buffer.from(b64(xml))).toString("base64");
  const serviceKey = crypto.randomBytes(66).toString("base64"); // 88 chars
  const rc = aesEncrypt(APP_KEY, APP_IV, key).toString("base64");
  return { file: payload + serviceKey, serviceKey, rc };
}

