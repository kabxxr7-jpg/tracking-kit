/** Decides what happens to each request the page makes. Pure, so it is unit-tested without a browser. */

export type Mode = "local" | "external";

export type Action =
  | { kind: "allow" }
  | { kind: "emulate-gtm" }
  | { kind: "stub-script" }
  | { kind: "record-hit" }
  | { kind: "block"; reason: string };

const ANALYTICS_HOST = /(^|\.)(google-analytics\.com|analytics\.google\.com|doubleclick\.net|googleadservices\.com)$/i;
const TAG_HOST = /(^|\.)googletagmanager\.com$/i;

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}

export function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopbackHost(h)) return true;
  if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  return h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80:");
}

export function isAnalyticsRequest(u: URL): boolean {
  if (ANALYTICS_HOST.test(u.hostname)) return true;
  // google.com hosts a few measurement endpoints next to its search pages.
  return /(^|\.)google\.com$/i.test(u.hostname) && /^\/(ccm\/collect|pagead\/)/.test(u.pathname);
}

export function classify(rawUrl: string, method: string, mode: Mode, targetHost: string): Action {
  let u: URL;
  try { u = new URL(rawUrl); } catch { return { kind: "block", reason: "unparseable URL" }; }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return { kind: "allow" };
  const m = method.toUpperCase();

  if (isAnalyticsRequest(u)) return { kind: "record-hit" };

  if (TAG_HOST.test(u.hostname)) {
    if (mode === "local") return /^\/gtm\.js$/.test(u.pathname) ? { kind: "emulate-gtm" } : { kind: "stub-script" };
    return m === "GET" || m === "HEAD" ? { kind: "allow" } : { kind: "block", reason: `${m} to a tag host blocked (read-only mode)` };
  }

  if (mode === "local") {
    return isLoopbackHost(u.hostname) ? { kind: "allow" } : { kind: "block", reason: "non-local host blocked (offline mode)" };
  }

  // external: read-only page load
  if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") return { kind: "block", reason: `${m} blocked (read-only mode)` };
  if (isPrivateHost(u.hostname) && u.hostname.toLowerCase() !== targetHost.toLowerCase()) {
    return { kind: "block", reason: "request to a private or loopback address blocked" };
  }
  return { kind: "allow" };
}
