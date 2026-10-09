import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { maskProxyUrl, proxiedFetch, proxyUrlError, unmaskProxyUrl } from "./net";

let target: http.Server;
let targetPort = 0;
let httpProxy: http.Server;
let httpProxyPort = 0;
let socks: net.Server;
let socksPort = 0;
const seen = { httpProxy: [] as string[], proxyAuth: [] as (string | undefined)[], socks: [] as string[], socksAuth: [] as string[] };

/** Pipes a client socket to host:port. */
function tunnel(client: net.Socket, host: string, port: number, onReady: () => void) {
  const upstream = net.connect(port, host, () => {
    onReady();
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on("error", () => client.destroy());
  client.on("error", () => upstream.destroy());
}

/** Minimal SOCKS5 server: username/password auth, CONNECT to IPv4 or domain names. */
function socksServer() {
  return net.createServer((client) => {
    client.once("data", (greeting) => {
      if (greeting[0] !== 5) return client.destroy();
      client.write(Buffer.from([5, 2])); // username/password
      client.once("data", (auth) => {
        const ulen = auth[1];
        const user = auth.subarray(2, 2 + ulen).toString();
        const plen = auth[2 + ulen];
        const pass = auth.subarray(3 + ulen, 3 + ulen + plen).toString();
        seen.socksAuth.push(`${user}:${pass}`);
        client.write(Buffer.from([1, user === "nord" && pass === "secret" ? 0 : 1]));
        client.once("data", (req) => {
          let host: string;
          let offset: number;
          if (req[3] === 1) {
            host = [...req.subarray(4, 8)].join(".");
            offset = 8;
          } else if (req[3] === 3) {
            host = req.subarray(5, 5 + req[4]).toString();
            offset = 5 + req[4];
          } else return client.destroy();
          const port = req.readUInt16BE(offset);
          seen.socks.push(`${host}:${port}`);
          tunnel(client, host === "localhost" ? "127.0.0.1" : host, port, () =>
            client.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])),
          );
        });
      });
    });
  });
}

beforeAll(async () => {
  target = http.createServer((req, res) => res.end(`hello ${req.url}`));
  httpProxy = http.createServer((req, res) => {
    // Plain-HTTP forwarding (absolute-form request target).
    seen.httpProxy.push(req.url!);
    seen.proxyAuth.push(req.headers["proxy-authorization"]);
    const u = new URL(req.url!);
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: req.method }, (r) => {
      res.writeHead(r.statusCode!, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  httpProxy.on("connect", (req, client) => {
    seen.httpProxy.push(`CONNECT ${req.url}`);
    seen.proxyAuth.push(req.headers["proxy-authorization"]);
    const [host, port] = req.url!.split(":");
    tunnel(client as net.Socket, host, Number(port), () => client.write("HTTP/1.1 200 Connection Established\r\n\r\n"));
  });
  socks = socksServer();
  const listen = (s: net.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
  [targetPort, httpProxyPort, socksPort] = await Promise.all([listen(target), listen(httpProxy), listen(socks)]);
});

afterAll(() => {
  for (const s of [target, httpProxy, socks]) s.close();
});

describe("proxiedFetch", () => {
  it("goes through an HTTP proxy, sending basic auth from the URL", async () => {
    const f = proxiedFetch(`http://user:p%40ss@127.0.0.1:${httpProxyPort}`);
    const res = await f(`http://127.0.0.1:${targetPort}/page`);
    expect(await res.text()).toBe("hello /page");
    expect(seen.httpProxy.at(-1)).toContain(`127.0.0.1:${targetPort}`);
    expect(seen.proxyAuth.at(-1)).toBe(`Basic ${Buffer.from("user:p@ss").toString("base64")}`);
  });

  it("goes through a SOCKS5 proxy with username/password", async () => {
    const f = proxiedFetch(`socks5://nord:secret@127.0.0.1:${socksPort}`);
    const res = await f(`http://127.0.0.1:${targetPort}/via-socks`);
    expect(await res.text()).toBe("hello /via-socks");
    expect(seen.socks.at(-1)).toBe(`127.0.0.1:${targetPort}`);
    expect(seen.socksAuth.at(-1)).toBe("nord:secret");
  });

  it("fails cleanly with wrong SOCKS credentials", async () => {
    const f = proxiedFetch(`socks5://nord:wrong@127.0.0.1:${socksPort}`);
    await expect(f(`http://127.0.0.1:${targetPort}/x`)).rejects.toThrow();
  });
});

describe("proxy URL helpers", () => {
  it.each([
    ["", null],
    ["http://gluetun:8888", null],
    ["socks5://u:p@ca1234.nordvpn.com:1080", null],
    ["ftp://x:21", "Use http://, https:// or socks5://"],
    ["http://gluetun", "Include the host and port, e.g. http://gluetun:8888"],
    ["not a url", "Not a valid URL"],
  ])("validates %j", (url, error) => {
    expect(proxyUrlError(url)).toBe(error);
  });

  it("masks and restores the password", () => {
    const stored = "socks5://nord:s3cr%23t@proxy.example:1080";
    const shown = maskProxyUrl(stored);
    expect(shown).toBe("socks5://nord:••••••••@proxy.example:1080");
    expect(shown).not.toContain("s3cr");
    expect(unmaskProxyUrl(shown, stored)).toBe("socks5://nord:s3cr%23t@proxy.example:1080");
    expect(unmaskProxyUrl("socks5://other:new@p:1080", stored)).toBe("socks5://other:new@p:1080");
    expect(maskProxyUrl("http://gluetun:8888")).toBe("http://gluetun:8888");
  });
});
