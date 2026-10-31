import { spawnSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAudit, UsageError } from "../src/audit.js";
import { ROOT, startServer, type RunningServer } from "../src/server.js";

const CLI = ["--import", "tsx", path.join(ROOT, "src", "cli.ts")];
const cli = (...args: string[]) => spawnSync(process.execPath, [...CLI, ...args], { cwd: ROOT, encoding: "utf8", timeout: 90_000 });

describe("audit against the local demos", () => {
  it("demo: every check passes and the markdown says so", async () => {
    const out = await runAudit({ target: "demo", now: new Date("2026-01-01T00:00:00Z") });
    expect(out.ok).toBe(true);
    expect(out.mode).toBe("local");
    expect(out.results.filter((r) => r.status === "fail")).toEqual([]);
    expect(out.markdown).toContain("# Tracking audit: http://127.0.0.1:");
    expect(out.markdown).toContain("Result: **PASS** (14 passed, 0 failed, 0 not applicable)");
    expect(out.markdown).toContain("Date: 2026-01-01T00:00:00.000Z");
    expect(out.markdown).toContain("| Check | Result | Detail |");
    expect(out.markdown).toContain("purchase x1");
  });

  it("demo-broken: fails, names the failing checks, and still lists the passing ones", async () => {
    const out = await runAudit({ target: "demo-broken" });
    expect(out.ok).toBe(false);
    const failed = out.results.filter((r) => r.status === "fail").map((r) => r.id).sort();
    expect(failed).toEqual(["consent-default", "ecommerce-cleared", "hit-params", "hits-match-events", "items-valid", "no-hits-before-consent", "no-pii", "numeric-values", "purchase-once"]);
    expect(out.markdown).toContain("Result: **FAIL**");
    expect(out.markdown).toContain("**FAIL**");
    expect(out.markdown).toContain("purchase x2");
  });

  it("the value policy option changes the verdict: 'items' makes the demo's purchase value wrong", async () => {
    const out = await runAudit({ target: "demo", valuePolicy: "items" });
    expect(out.results.find((r) => r.id === "value-math")!.status).toBe("fail");
  });

  it("a supplied personal value is searched for in everything captured", async () => {
    const out = await runAudit({ target: "demo", piiValues: ["Northwind Pots"] });
    // "Northwind Pots" is the brand in item_brand, so this proves the option is wired up
    expect(out.results.find((r) => r.id === "no-pii")!.status).toBe("fail");
  });
});

describe("audit refuses unsafe or unknown targets", () => {
  it("rejects a non-http URL and garbage", async () => {
    await expect(runAudit({ target: "file:///etc/hosts" })).rejects.toThrow(UsageError);
    await expect(runAudit({ target: "not a url" })).rejects.toThrow(UsageError);
  });
  it("rejects --walk against an external host before any browser starts", async () => {
    await expect(runAudit({ target: "https://shop.example.test/", walk: true })).rejects.toThrow(/only allowed for local/);
  });
});

describe("audit of an external-looking site is read-only", () => {
  let site: RunningServer;
  let port: number;
  beforeAll(async () => {
    site = await startServer(path.join(ROOT, "tests", "fixtures", "external-like"));
    port = site.port;
  });
  afterAll(async () => { await site.close(); });

  it("loads once, blocks the write and the loopback request, records but never sends the beacon, clicks nothing", async () => {
    // shop.example.test resolves to this machine only inside the test browser, so the audit treats it as an external host
    const out = await runAudit({
      target: `http://shop.example.test:${port}/`,
      chromiumArgs: ["--host-resolver-rules=MAP shop.example.test 127.0.0.1"]
    });
    expect(out.mode).toBe("external");
    // the page's POST never reached the server; only GETs did
    expect(site.requests.filter((r) => r.method !== "GET")).toEqual([]);
    expect(site.requests.map((r) => r.path)).toEqual(["/"]);
    const reasons = out.capture.blocked.map((b) => `${b.method} ${new URL(b.url).pathname} ${b.reason}`);
    expect(reasons.some((r) => r.startsWith("POST /write"))).toBe(true);
    expect(reasons.some((r) => r.includes("/internal") && r.includes("private or loopback"))).toBe(true);
    // the beacon was recorded for the report only
    expect(out.capture.hits.map((h) => h.params.en)).toEqual(["page_view"]);
    // nothing was clicked
    expect(out.capture.pushes.some((p) => JSON.stringify(p.data).includes("clicked_by_audit"))).toBe(false);
    // and the report says what it saw
    expect(out.markdown).toContain("Mode: external, read-only");
    expect(out.results.find((r) => r.id === "consent-default")!.status).toBe("fail");
    expect(out.results.find((r) => r.id === "no-hits-before-consent")!.status).toBe("fail");
    expect(out.results.some((r) => r.id === "hits-match-events")).toBe(false);
    expect(out.ok).toBe(false);
  });
});

describe("command line", () => {
  it("audit demo exits 0 and prints markdown", () => {
    const r = cli("audit", "demo");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("# Tracking audit:");
    expect(r.stdout).toContain("**PASS**");
  });
  it("audit demo-broken exits 1", () => {
    const r = cli("audit", "demo-broken");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("**FAIL**");
  });
  it("usage errors exit 2 with a message", () => {
    expect(cli("audit").status).toBe(2);
    expect(cli("audit", "file:///etc/hosts").status).toBe(2);
    expect(cli("audit", "demo", "--value-policy", "nonsense").status).toBe(2);
    expect(cli("nonsense").status).toBe(2);
    expect(cli().status).toBe(2);
  });
  it("validate-gtm exits 0 for the committed export and 1 for a broken one", () => {
    expect(cli("validate-gtm").status).toBe(0);
    const bad = cli("validate-gtm", path.join(ROOT, "package.json"));
    expect(bad.status).toBe(1);
    expect(bad.stdout).toContain("ERROR");
  });
});
