import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_DIRS = { demo: path.join(ROOT, "demo"), "demo-broken": path.join(ROOT, "demo-broken") } as const;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

export interface ServedRequest {
  method: string;
  path: string;
}

export interface RunningServer {
  url: string;
  port: number;
  requests: ServedRequest[];
  close(): Promise<void>;
}

/** Serves one static folder on 127.0.0.1. Port 0 picks a free port. */
export async function startServer(root: string, port = 0): Promise<RunningServer> {
  const requests: ServedRequest[] = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    requests.push({ method: req.method ?? "GET", path: url.pathname });
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(root, "." + rel);
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    requests,
    close: () => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); })
  };
}
