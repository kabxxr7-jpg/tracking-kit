import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFunnel, type WalkResult } from "../src/funnel.js";
import { validate } from "../src/validator.js";
import type { CheckResult } from "../src/types.js";
import { ecomPushes, hitsFor, newSession, objectPushes, startEnv, type Env, type Session } from "./helpers.js";

let env: Env;
let s: Session;
let walk: WalkResult;
let freshLoad: Session;
let results: CheckResult[];

beforeAll(async () => {
  env = await startEnv();
  // a first visit that touches nothing
  freshLoad = await newSession(env, env.broken.url);
  await freshLoad.page.goto(env.broken.url + "/");
  await freshLoad.page.waitForSelector("#product-list");
  await freshLoad.harness.quiesce(300);
  // the whole funnel, accepting the banner on the first page, then a reload of the thank-you page
  s = await newSession(env, env.broken.url);
  walk = await walkFunnel(s.page, s.harness, env.broken.url, { consent: "all" });
  await s.page.reload();
  await s.harness.quiesce(300);
  results = validate(s.capture, { expectHits: true, requireFunnel: true, piiValues: [walk.email] });
}, 120_000);
afterAll(async () => { await env.close(); });

const byId = (id: string) => results.find((r) => r.id === id)!;

describe("demo-broken really has the classic bugs (facts from the raw capture)", () => {
  it("analytics hits fire on the very first page load, before anyone chose anything", () => {
    expect(freshLoad.capture.hits.length).toBeGreaterThan(0);
    expect(freshLoad.capture.hits[0]!.params.en).toBe("page_view");
    expect(freshLoad.capture.pushes.some((p) => p.kind === "command" && (p.data as any[])[1] === "default")).toBe(false);
  });
  it("purchase is pushed twice for one order after a reload", () => {
    const p = ecomPushes(s.capture).filter((e) => e.name === "purchase");
    expect(p).toHaveLength(2);
    expect(p[0]!.ecommerce.transaction_id).toBe(p[1]!.ecommerce.transaction_id);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(2);
  });
  it("value is the string \"$88.09\"", () => {
    expect(ecomPushes(s.capture).find((e) => e.name === "purchase")!.ecommerce.value).toBe("$88.09");
  });
  it("items have no item_id", () => {
    expect(ecomPushes(s.capture).every((e) => e.ecommerce.items.every((i: any) => i.item_id === undefined && typeof i.item_name === "string"))).toBe(true);
  });
  it("ecommerce is never cleared with { ecommerce: null } before an event", () => {
    expect(objectPushes(s.capture).some((p) => p.data.ecommerce === null)).toBe(false);
  });
  it("the email address is in the purchase push and in the page URL sent with hits", () => {
    expect(JSON.stringify(objectPushes(s.capture).map((p) => p.data))).toContain(walk.email);
    expect(decodeURIComponent(hitsFor(s.capture, "purchase")[0]!.params.dl!)).toContain("email=" + walk.email);
  });
});

describe("the kit validator catches each bug", () => {
  it.each([
    ["consent-default", /No gtag\('consent','default'/],
    ["no-hits-before-consent", /before analytics consent was granted/],
    ["ecommerce-cleared", /Not cleared before/],
    ["items-valid", /item_id/],
    ["numeric-values", /value is string "\$88\.09"/],
    ["purchase-once", /Duplicate purchase: NW-\d+ x2/],
    ["no-pii", /user_email/],
    ["hit-params", /sent as text: \$88\.09/]
  ])("%s fails with a useful message", (id, message) => {
    expect(byId(id).status).toBe("fail");
    expect(byId(id).detail).toMatch(message);
  });

  it("the PII failure shows the leak in the dataLayer push and in a hit, and never prints the full address", () => {
    const pushPart = byId("no-pii").detail;
    expect(pushPart).toMatch(/dataLayer push #\d+ user_email/);
    expect(pushPart).not.toContain("casey.example");
    // the same capture with the pushes removed leaves only the hits, so the hit-level finding is visible on its own
    const hitPart = validate({ ...s.capture, pushes: [] }).find((r) => r.id === "no-pii")!;
    expect(hitPart.status).toBe("fail");
    expect(hitPart.detail).toMatch(/hit #\d+ \((purchase|page_view)\) param dl/);
    expect(hitPart.detail).not.toContain("casey.example");
  });

  it("checks that are not broken still pass (the validator does not fail everything)", () => {
    for (const id of ["required-params", "currency", "value-math", "event-order", "funnel-complete"]) expect(byId(id).status, id).toBe("pass");
  });
});
