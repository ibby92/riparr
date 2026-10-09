import http from "node:http";
import { receiveClickNLoad } from "@/lib/clicknload";
import { decryptCnl2 } from "@/lib/crawlers";

const MAX_BODY = 1024 * 1024;

// Pages probe these to decide whether a "JDownloader" is listening.
const JDCHECK = "jdownloader=true;\nvar version='43307';\n";
const CROSSDOMAIN = `<?xml version="1.0"?>
<!DOCTYPE cross-domain-policy SYSTEM "http://www.macromedia.com/xml/dtds/cross-domain-policy.dtd">
<cross-domain-policy><allow-access-from domain="*" /></cross-domain-policy>`;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function reply(res: http.ServerResponse, status: number, body: string, type = "text/plain") {
  res.writeHead(status, {
    "content-type": `${type}; charset=utf-8`,
    // Pages call this from their own origin.
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
  });
  res.end(body);
}

/** Handles one Click'n'Load request. Exported for tests. */
export async function handleCnl(req: http.IncomingMessage, res: http.ServerResponse) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/\/+$/, "") || "/";

  if (req.method === "OPTIONS") return reply(res, 204, "");
  if (req.method === "GET") {
    if (path === "/jdcheck.js") return reply(res, 200, JDCHECK, "text/javascript");
    if (path === "/crossdomain.xml") return reply(res, 200, CROSSDOMAIN, "text/xml");
    if (path === "/flash" || path === "/") return reply(res, 200, "JDownloader");
    return reply(res, 404, "Not found");
  }
  if (req.method !== "POST" || (path !== "/flash/addcrypted2" && path !== "/flash/add")) {
    return reply(res, 404, "Not found");
  }

  try {
    const form = new URLSearchParams(await readBody(req));
    const source = form.get("source") || req.headers.referer || null;
    const links =
      path === "/flash/addcrypted2"
        ? decryptCnl2(form.get("jk") ?? "", form.get("crypted") ?? "")
        : (form.get("urls") ?? "").split(/[\r\n]+/);
    const result = receiveClickNLoad(links, source, form.get("passwords")?.trim() || null);
    console.log(`[riparr] click'n'load: ${result.added}/${result.received} new link(s) from ${source ?? "unknown page"}`);
    return reply(res, 200, "success\r\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[riparr] click'n'load request failed:", message);
    return reply(res, 400, `failed ${message}\r\n`);
  }
}

export function startCnlServer(port: number, host = "0.0.0.0"): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    handleCnl(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, "failed\r\n");
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
