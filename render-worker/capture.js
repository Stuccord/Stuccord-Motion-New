// Screenshots a web page for an app screen graphic (POST /capture). Only
// public web addresses: the page is opened in the worker's own headless
// Chrome (the one Remotion draws with), and every connection it makes goes
// through a small local proxy that refuses private, loopback, link-local and
// other internal addresses - so a link can't be used to look inside the
// network the worker runs in. The page is loaded once by us first (each
// redirect checked the same way), so a dead or refused link gives a clear
// message instead of a picture of Chrome's error page.

import { spawn } from "child_process";
import dns from "dns/promises";
import fsp from "fs/promises";
import http from "http";
import https from "https";
import net from "net";
import os from "os";
import path from "path";

/** A problem to show the user as is. */
export class CaptureError extends Error {}

// Addresses that aren't the public internet (IPv4 and IPv6).
const blocked = new net.BlockList();
for (const [a, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(a, bits, "ipv4");
for (const [a, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
]) blocked.addSubnet(a, bits, "ipv6");

/** Whether an IP address is on the public internet. */
export function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return !blocked.check(ip, "ipv4");
  if (v === 6) {
    // An IPv4 address written as IPv6 (::ffff:10.0.0.1) is checked as IPv4.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (mapped) return isPublicIp(mapped[1]);
    return !blocked.check(ip, "ipv6");
  }
  return false;
}

const PORTS = new Set([80, 443]);
const BAD_HOST = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|onion)$/i;

/**
 * The address to capture, tidied ("stripe.com" becomes "https://stripe.com/"),
 * or a CaptureError saying why it can't be.
 */
export function captureUrl(raw) {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 500) throw new CaptureError("Paste a web address, like stripe.com.");
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw new CaptureError("That doesn't look like a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new CaptureError("Only http and https web addresses can be captured.");
  if (url.username || url.password) throw new CaptureError("Leave any password out of the address.");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (!PORTS.has(port)) throw new CaptureError("Only ordinary web addresses can be captured.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) ? !isPublicIp(host) : BAD_HOST.test(host) || !host.includes("."))
    throw new CaptureError("That address isn't on the public internet.");
  url.hash = "";
  return url;
}

/** A public address for a host name, or null when it has none (or any private one). */
async function publicAddress(host) {
  const h = host.replace(/^\[|\]$/g, "");
  if (net.isIP(h)) return isPublicIp(h) ? h : null;
  if (BAD_HOST.test(h)) return null;
  let found;
  try {
    found = await dns.lookup(h, { all: true, verbatim: true });
  } catch {
    return null;
  }
  // Refused if any of its addresses is internal (one name, mixed answers).
  if (!found.length || found.some((a) => !isPublicIp(a.address))) return null;
  return found[0].address;
}

/**
 * Loads the page once ourselves, following up to 5 redirects (each checked),
 * so a dead or refused link fails with a clear message. Returns the final address.
 */
async function probe(url, ua) {
  let at = url;
  for (let hop = 0; hop < 6; hop++) {
    const ip = await publicAddress(at.hostname);
    if (!ip) throw new CaptureError("That address isn't on the public internet, or doesn't exist.");
    const status = await new Promise((resolve, reject) => {
      const lib = at.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          host: ip,
          port: Number(at.port || (at.protocol === "https:" ? 443 : 80)),
          path: `${at.pathname}${at.search}`,
          method: "GET",
          servername: net.isIP(at.hostname) ? undefined : at.hostname,
          headers: { host: at.host, "user-agent": ua, accept: "text/html,*/*" },
          timeout: 10_000,
        },
        (res) => {
          res.destroy();
          resolve({ code: res.statusCode ?? 0, location: res.headers.location });
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    }).catch(() => {
      throw new CaptureError("Couldn't reach that page. Check the address and try again.");
    });
    if (status.code >= 300 && status.code < 400 && status.location) {
      at = captureUrl(new URL(status.location, at).toString());
      continue;
    }
    if (status.code >= 400)
      throw new CaptureError(`That page answered with an error (${status.code}). Try another address, or upload a screenshot.`);
    return at;
  }
  throw new CaptureError("That page redirects too many times.");
}

/** Most bytes a capture may pull in, and connections it may open. */
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_CONNECTIONS = 120;

/**
 * The local proxy Chrome goes through: HTTPS tunnels (CONNECT) and plain
 * HTTP, each only to public addresses on ports 80 and 443.
 */
export function guardProxy() {
  let bytes = 0;
  let connections = 0;
  const count = (stream, other) =>
    stream.on("data", (b) => {
      bytes += b.length;
      if (bytes > MAX_BYTES) {
        stream.destroy();
        other?.destroy();
      }
    });
  const server = http.createServer(async (req, res) => {
    try {
      if (++connections > MAX_CONNECTIONS) throw new Error("too many");
      const u = new URL(req.url);
      const port = Number(u.port || 80);
      const ip = u.protocol === "http:" && PORTS.has(port) ? await publicAddress(u.hostname) : null;
      if (!ip) {
        res.writeHead(403).end();
        return;
      }
      const headers = { ...req.headers, host: u.host };
      delete headers["proxy-connection"];
      const up = http.request({ host: ip, port, method: req.method, path: `${u.pathname}${u.search}`, headers }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        count(r, res);
        r.pipe(res);
      });
      up.on("error", () => res.destroy());
      req.pipe(up);
    } catch {
      res.writeHead(400).end();
    }
  });
  server.on("connect", async (req, socket, head) => {
    socket.on("error", () => {});
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? "");
    const port = m ? Number(m[2]) : 0;
    const ip = m && PORTS.has(port) && ++connections <= MAX_CONNECTIONS ? await publicAddress(m[1]) : null;
    if (!ip) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const up = net.connect(port, ip, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head?.length) up.write(head);
      count(up, socket);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("close", () => up.destroy());
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ port: server.address().port, close: () => server.close() }));
  });
}

const DEVICES = {
  // A tall page so the graphic can scroll down it.
  browser: {
    width: 1280,
    height: 2200,
    scale: 1.5,
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  },
  phone: {
    width: 390,
    height: 1700,
    scale: 2,
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  },
};

/** The headless Chrome Remotion uses (downloaded with the worker). */
async function chromePath() {
  const { ensureBrowser } = await import("@remotion/renderer");
  const status = await ensureBrowser();
  if (status?.path) return status.path;
  throw new Error("No headless browser on the worker");
}

/** Screenshots a public page as a PNG (a phone's or a laptop's view). */
export async function capturePage({ url: raw, device = "browser", timeoutMs = 40_000 }) {
  const d = DEVICES[device] ?? DEVICES.browser;
  const url = await probe(captureUrl(raw), d.ua);
  const exe = await chromePath();
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "stuccord-capture-"));
  const proxy = await guardProxy();
  try {
    const out = path.join(dir, "page.png");
    const args = [
      "--headless",
      "--disable-gpu",
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-sync",
      "--disable-default-apps",
      "--disable-component-update",
      "--dns-prefetch-disable",
      // Everything through the guard, loopback included, and no direct UDP.
      `--proxy-server=http://127.0.0.1:${proxy.port}`,
      "--proxy-bypass-list=<-loopback>",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      `--user-data-dir=${path.join(dir, "profile")}`,
      `--window-size=${d.width},${d.height}`,
      `--force-device-scale-factor=${d.scale}`,
      `--user-agent=${d.ua}`,
      // Give the page time to load and settle before the picture.
      "--virtual-time-budget=9000",
      `--screenshot=${out}`,
      url.toString(),
    ];
    await new Promise((resolve, reject) => {
      const p = spawn(exe, args, { stdio: "ignore" });
      const timer = setTimeout(() => {
        p.kill("SIGKILL");
        reject(new CaptureError("That page took too long to load."));
      }, timeoutMs);
      p.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      p.on("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const png = await fsp.readFile(out).catch(() => null);
    if (!png || png.length < 1000 || png.subarray(1, 4).toString() !== "PNG")
      throw new CaptureError("Couldn't capture that page. Try again, or upload a screenshot.");
    return { png, url: url.toString() };
  } finally {
    proxy.close();
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
