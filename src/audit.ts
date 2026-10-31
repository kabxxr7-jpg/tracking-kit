import { launchBrowser } from "./browser.js";
import { walkFunnel } from "./funnel.js";
import { Harness, loadContainer } from "./harness.js";
import { isLoopbackHost, type Mode } from "./policy.js";
import { DEMO_DIRS, startServer, type RunningServer } from "./server.js";
import type { Capture, CheckResult, ValuePolicy } from "./types.js";
import { summarize, validate } from "./validator.js";

export interface AuditOptions {
  /** "demo", "demo-broken", or an http(s) URL. */
  target: string;
  /** Walk the demo funnel (local targets only). Defaults to true for the two shorthands. */
  walk?: boolean;
  containerFile?: string;
  valuePolicy?: ValuePolicy;
  piiValues?: string[];
  chromiumArgs?: string[];
  /** Overrides the "Date" line, so tests can compare output. */
  now?: Date;
}

export interface AuditOutcome {
  markdown: string;
  results: CheckResult[];
  ok: boolean;
  mode: Mode;
  capture: Capture;
}

export class UsageError extends Error {}

const USER_AGENT = "tracking-kit-audit/0.1 (GET-only page load)";

export async function runAudit(opts: AuditOptions): Promise<AuditOutcome> {
  let server: RunningServer | null = null;
  let url: string;
  let walk = opts.walk;
  if (opts.target === "demo" || opts.target === "demo-broken") {
    server = await startServer(DEMO_DIRS[opts.target]);
    url = server.url + "/";
    walk ??= true;
  } else {
    let parsed: URL;
    try { parsed = new URL(opts.target); } catch { throw new UsageError(`"${opts.target}" is not a URL, "demo" or "demo-broken"`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new UsageError("only http(s) URLs are supported");
    url = parsed.toString();
  }
  const host = new URL(url).hostname;
  const mode: Mode = isLoopbackHost(host) ? "local" : "external";
  if (walk && mode === "external") {
    await server?.close();
    throw new UsageError("--walk clicks through a site, so it is only allowed for local (loopback) targets. External sites get one GET-only page load.");
  }

  const browser = await launchBrowser({ args: opts.chromiumArgs ?? [] });
  try {
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const harness = await Harness.attach(context, {
      mode,
      targetHost: host,
      ...(mode === "local" ? { container: loadContainer(opts.containerFile) } : {})
    });
    const page = await context.newPage();
    if (walk) {
      const base = url.replace(/\/$/, "");
      const w = await walkFunnel(page, harness, base, { consent: "all" });
      await page.reload();
      await harness.quiesce();
      void w;
    } else {
      await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      await harness.quiesce(300, 5000);
    }
    const capture = harness.capture;
    const results = validate(capture, {
      expectHits: mode === "local",
      requireFunnel: !!walk,
      ...(opts.valuePolicy ? { valuePolicy: opts.valuePolicy } : {}),
      ...(opts.piiValues ? { piiValues: opts.piiValues } : {})
    });
    const ok = results.every((r) => r.status !== "fail");
    return { markdown: renderMarkdown(url, mode, !!walk, results, capture, opts.now ?? new Date()), results, ok, mode, capture };
  } finally {
    await browser.close();
    await server?.close();
  }
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function renderMarkdown(url: string, mode: Mode, walked: boolean, results: CheckResult[], capture: Capture, now: Date): string {
  const s = summarize(results);
  const events = capture.pushes
    .filter((p) => p.kind === "object" && typeof p.data === "object" && p.data !== null && typeof (p.data as { event?: unknown }).event === "string")
    .map((p) => (p.data as { event: string }).event);
  const eventCounts = new Map<string, number>();
  for (const e of events) eventCounts.set(e, (eventCounts.get(e) ?? 0) + 1);
  const hitCounts = new Map<string, number>();
  for (const h of capture.hits) hitCounts.set(h.params.en ?? "(no en)", (hitCounts.get(h.params.en ?? "(no en)") ?? 0) + 1);
  const fmt = (m: Map<string, number>) => (m.size ? [...m].map(([k, n]) => `${k} x${n}`).join(", ") : "none");

  const lines: string[] = [];
  lines.push(`# Tracking audit: ${url}`, "");
  lines.push(`- Result: **${s.fail ? "FAIL" : "PASS"}** (${s.pass} passed, ${s.fail} failed, ${s.skip} not applicable)`);
  lines.push(`- Date: ${now.toISOString()}`);
  lines.push(
    mode === "local"
      ? "- Mode: local. Google Tag Manager is emulated from `gtm/container.json`, every request to Google hosts is intercepted, nothing leaves this machine."
      : "- Mode: external, GET-only. One page load, no clicks, no form input, every non-GET request blocked, every analytics hit recorded and not sent. (GET requests made by the page can still have side effects on that site.)"
  );
  if (walked) lines.push("- Scenario: scripted funnel walk of the demo (consent accepted on the first page), then a reload of the thank-you page.");
  lines.push("", "| Check | Result | Detail |", "|---|---|---|");
  for (const r of results) {
    lines.push(`| ${cell(r.title)} | ${r.status === "pass" ? "PASS" : r.status === "fail" ? "**FAIL**" : "n/a"} | ${cell(r.detail)} |`);
  }
  lines.push("", "## Observed", "");
  lines.push(`- dataLayer events: ${fmt(eventCounts)}`);
  lines.push(`- Analytics hits (by event): ${fmt(hitCounts)}`);
  const scriptCounts = new Map<string, number>();
  for (const x of capture.scripts) { const k = `${new URL(x.url).pathname} (${x.served})`; scriptCounts.set(k, (scriptCounts.get(k) ?? 0) + 1); }
  lines.push(`- Tag scripts requested: ${fmt(scriptCounts)}`);
  lines.push(`- Requests blocked: ${capture.blocked.length}${capture.blocked.length ? " (" + [...new Set(capture.blocked.map((b) => b.reason))].join("; ") + ")" : ""}`);
  lines.push("", "## Notes", "");
  lines.push("- Consent rules assume \"basic\" Consent Mode: no analytics hit before analytics_storage is granted. A site on \"advanced\" mode (cookieless pings while denied) will show failures here by design.");
  if (mode === "external") lines.push("- Only the state before any consent choice was observed. Post-consent behaviour, the checkout funnel and purchase de-duplication need a real session (see docs/qa-checklist.md).");
  lines.push("- Passing this report does not prove the numbers in GA4 are right. See docs/qa-checklist.md for the DebugView steps.");
  return lines.join("\n") + "\n";
}
