import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFunnel } from "../src/funnel.js";
import { validate } from "../src/validator.js";
import { commands, ecomPushes, hitsFor, newSession, startEnv, type Env } from "./helpers.js";

let env: Env;
beforeAll(async () => { env = await startEnv(); });
afterAll(async () => { await env.close(); });

const DENIED = { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
const consentUpdates = (cap: Parameters<typeof commands>[0]) => commands(cap).filter((c) => c.args[0] === "consent" && c.args[1] === "update");

describe("consent mode v2 on the demo store", () => {
  it("before any choice: default is denied for all four types, banner is shown, no tag script and no hit", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/");
    await s.page.waitForSelector("#product-list");
    await s.harness.quiesce(300);
    expect(s.capture.pushes[0]!.data).toEqual(["consent", "default", DENIED]);
    expect(await s.page.isVisible("#consent-banner")).toBe(true);
    expect(s.capture.scripts).toEqual([]);
    expect(s.capture.hits).toEqual([]);
    expect(consentUpdates(s.capture)).toEqual([]);
  });

  it("events are still pushed to the dataLayer before consent (they are just not sent anywhere)", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/product.html?id=NW-HERB-3");
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(ecomPushes(s.capture).map((e) => e.name)).toEqual(["view_item", "add_to_cart"]);
    expect(s.capture.hits).toEqual([]);
    expect(s.capture.scripts).toEqual([]);
  });

  it("walking the whole funnel without answering the banner sends zero hits", async () => {
    const s = await newSession(env, env.demo.url);
    await walkFunnel(s.page, s.harness, env.demo.url);
    expect(ecomPushes(s.capture).some((e) => e.name === "purchase")).toBe(true);
    expect(s.capture.hits).toEqual([]);
    expect(s.capture.scripts).toEqual([]);
    const results = validate(s.capture, { expectHits: true });
    expect(results.find((r) => r.id === "no-hits-before-consent")!.status).toBe("pass");
  });

  it("Accept all: grants all four types, then loads the tag manager, then hits flow", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/");
    await s.page.click("#consent-accept-all");
    await s.harness.quiesce(300);
    const [update] = consentUpdates(s.capture);
    expect(update!.args[2]).toEqual({ analytics_storage: "granted", ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
    expect(s.capture.scripts).toHaveLength(1);
    expect(s.capture.scripts[0]!.seq).toBeGreaterThan(update!.seq);
    const pageViews = hitsFor(s.capture, "page_view");
    expect(pageViews).toHaveLength(1);
    expect(pageViews[0]!.seq).toBeGreaterThan(update!.seq);
    expect(pageViews[0]!.params.gcs).toBe("G111");
    expect(await s.page.isVisible("#consent-banner")).toBe(false);
  });

  it("Analytics only: analytics granted, ads stay denied, hits report that (gcs G101)", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/product.html?id=NW-TROWEL");
    await s.page.click("#consent-analytics-only");
    await s.harness.quiesce(300);
    expect(consentUpdates(s.capture)[0]!.args[2]).toEqual({ analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(hitsFor(s.capture, "add_to_cart")).toHaveLength(1);
    for (const h of s.capture.hits) expect(h.params.gcs).toBe("G101");
  });

  it("Reject: everything stays denied, the tag manager is never requested, the shop still works", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/");
    await s.page.click("#consent-reject");
    const w = await walkFunnel(s.page, s.harness, env.demo.url);
    expect(w.transactionId).toMatch(/^NW-\d+$/);
    expect(consentUpdates(s.capture)[0]!.args[2]).toEqual(DENIED);
    expect(s.capture.scripts).toEqual([]);
    expect(s.capture.hits).toEqual([]);
    expect(ecomPushes(s.capture).some((e) => e.name === "purchase")).toBe(true);
  });

  it("a stored choice is replayed on the next page: no banner, update right after default, then the tag manager", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/");
    await s.page.click("#consent-accept-all");
    await s.harness.quiesce(300);
    const before = s.capture.pushes.length;
    await s.page.goto(env.demo.url + "/cart.html");
    await s.harness.quiesce(300);
    expect(await s.page.isVisible("#consent-banner")).toBe(false);
    const next = s.capture.pushes.slice(before);
    expect(next[0]!.data).toEqual(["consent", "default", DENIED]);
    expect((next[1]!.data as any[])[1]).toBe("update");
    expect((next[2]!.data as any).event).toBe("gtm.js");
  });

  it("Cookie settings lets the visitor withdraw consent: later events produce no hits", async () => {
    const s = await newSession(env, env.demo.url, { storedConsent: "all" });
    await s.page.goto(env.demo.url + "/product.html?id=NW-SAUCER-4");
    await s.harness.quiesce(300);
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(hitsFor(s.capture, "add_to_cart")).toHaveLength(1);
    await s.page.click("#cookie-settings");
    await s.page.click("#consent-reject");
    await s.harness.quiesce(300);
    const hitsBefore = s.capture.hits.length;
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(ecomPushes(s.capture).filter((e) => e.name === "add_to_cart")).toHaveLength(2);
    expect(s.capture.hits).toHaveLength(hitsBefore);
  });

  it("events pushed before the visitor answered are not sent afterwards (emulator behaviour)", async () => {
    const s = await newSession(env, env.demo.url);
    await s.page.goto(env.demo.url + "/");
    await s.harness.quiesce(300);
    await s.page.click("#consent-accept-all");
    await s.harness.quiesce(300);
    expect(ecomPushes(s.capture).map((e) => e.name)).toEqual(["view_item_list"]);
    expect(hitsFor(s.capture, "view_item_list")).toEqual([]);
  });

  it("the kit validator agrees: consent checks pass for accept-all, fail if a hit precedes consent", async () => {
    const s = await newSession(env, env.demo.url);
    await walkFunnel(s.page, s.harness, env.demo.url, { consent: "all" });
    const ok = validate(s.capture, { expectHits: true, requireFunnel: true });
    expect(ok.find((r) => r.id === "consent-default")!.status).toBe("pass");
    expect(ok.find((r) => r.id === "no-hits-before-consent")!.status).toBe("pass");
    // same capture with the hit timeline moved in front of the consent update
    const doctored = { ...s.capture, hits: s.capture.hits.map((h, i) => (i === 0 ? { ...h, seq: 0 } : h)) };
    expect(validate(doctored, { expectHits: true }).find((r) => r.id === "no-hits-before-consent")!.status).toBe("fail");
  });
});
