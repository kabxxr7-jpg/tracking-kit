import type { Browser, BrowserContext, Page } from "playwright-core";
import { launchBrowser } from "../src/browser.js";
import { Harness, type Container } from "../src/harness.js";
import { DEMO_DIRS, startServer, type RunningServer } from "../src/server.js";
import type { Capture, Hit, Push } from "../src/types.js";

export const FUNNEL_EVENTS = [
  "view_item_list", "view_item", "add_to_cart", "remove_from_cart", "view_cart",
  "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"
];

export interface Env {
  browser: Browser;
  demo: RunningServer;
  broken: RunningServer;
  sessions: BrowserContext[];
  close(): Promise<void>;
}

export async function startEnv(): Promise<Env> {
  const browser = await launchBrowser();
  const demo = await startServer(DEMO_DIRS.demo);
  const broken = await startServer(DEMO_DIRS["demo-broken"]);
  const sessions: BrowserContext[] = [];
  return {
    browser, demo, broken, sessions,
    async close() {
      for (const c of sessions) await c.close().catch(() => {});
      await browser.close();
      await demo.close();
      await broken.close();
    }
  };
}

export interface Session {
  context: BrowserContext;
  page: Page;
  harness: Harness;
  capture: Capture;
}

export interface SessionOptions {
  /** Pretend the visitor already chose this on an earlier visit. */
  storedConsent?: "all" | "analytics" | "reject";
  container?: Container;
}

export async function newSession(env: Env, siteUrl: string, opts: SessionOptions = {}): Promise<Session> {
  const context = await env.browser.newContext();
  env.sessions.push(context);
  if (opts.storedConsent) {
    await context.addInitScript((choice) => {
      try { if (localStorage.getItem("nw_consent") === null) localStorage.setItem("nw_consent", choice); } catch { /* ignore */ }
    }, opts.storedConsent);
  }
  const harness = await Harness.attach(context, {
    mode: "local",
    targetHost: new URL(siteUrl).hostname,
    ...(opts.container ? { container: opts.container } : {})
  });
  const page = await context.newPage();
  return { context, page, harness, capture: harness.capture };
}

/** Independent of src/validator.ts: the test reads the raw pushes itself. */
export function objectPushes(capture: Capture): Array<Push & { data: Record<string, any> }> {
  return capture.pushes.filter((p) => p.kind === "object") as Array<Push & { data: Record<string, any> }>;
}
export function ecomPushes(capture: Capture): Array<{ name: string; ecommerce: Record<string, any>; seq: number }> {
  return objectPushes(capture)
    .filter((p) => FUNNEL_EVENTS.includes(p.data.event))
    .map((p) => ({ name: p.data.event as string, ecommerce: p.data.ecommerce as Record<string, any>, seq: p.seq }));
}
export function commands(capture: Capture): Array<{ seq: number; args: any[] }> {
  return capture.pushes.filter((p) => p.kind === "command").map((p) => ({ seq: p.seq, args: p.data as any[] }));
}
export function hitsFor(capture: Capture, en: string): Hit[] {
  return capture.hits.filter((h) => h.params.en === en);
}
export function cents(n: number): number {
  return Math.round(n * 100);
}
