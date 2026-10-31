import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFunnel } from "../src/funnel.js";
import { ecomPushes, hitsFor, newSession, startEnv, type Env } from "./helpers.js";

let env: Env;
beforeAll(async () => { env = await startEnv(); });
afterAll(async () => { await env.close(); });

const purchases = (s: Awaited<ReturnType<typeof newSession>>) => ecomPushes(s.capture).filter((e) => e.name === "purchase");

async function placeOrder() {
  const s = await newSession(env, env.demo.url, { storedConsent: "all" });
  const w = await walkFunnel(s.page, s.harness, env.demo.url);
  return { s, w };
}

describe("purchase is reported once per transaction", () => {
  it("baseline: one purchase push and one purchase hit after placing the order", async () => {
    const { s } = await placeOrder();
    expect(purchases(s)).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("a page reload does not report it again", async () => {
    const { s } = await placeOrder();
    await s.page.reload();
    await s.page.waitForSelector("#order-id");
    await s.harness.quiesce(300);
    expect(await s.page.textContent("#order-id")).toMatch(/^NW-/);
    expect(purchases(s)).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("five reloads in a row still report it once", async () => {
    const { s } = await placeOrder();
    for (let i = 0; i < 5; i++) {
      await s.page.reload();
      await s.page.waitForSelector("#order-id");
    }
    await s.harness.quiesce(300);
    expect(purchases(s)).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("back to the checkout and forward to the thank-you page does not report it again", async () => {
    const { s } = await placeOrder();
    await s.page.goBack();
    await s.harness.quiesce(300);
    await s.page.goForward();
    await s.page.waitForSelector("#order-id");
    await s.harness.quiesce(300);
    expect(s.page.url()).toContain("/thank-you.html");
    expect(purchases(s)).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("opening the same thank-you URL again in the same tab does not report it again", async () => {
    const { s, w } = await placeOrder();
    await s.page.goto(w.thankYouUrl);
    await s.page.waitForSelector("#order-id");
    await s.harness.quiesce(300);
    expect(purchases(s)).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("the guard does not block a genuine second order in the same tab", async () => {
    const { s, w } = await placeOrder();
    const second = await walkFunnel(s.page, s.harness, env.demo.url);
    expect(second.transactionId).not.toBe(w.transactionId);
    const ids = purchases(s).map((p) => p.ecommerce.transaction_id);
    expect(ids).toEqual([w.transactionId, second.transactionId]);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(2);
  });

  it("a thank-you page opened with no order in the tab reports nothing", async () => {
    const s = await newSession(env, env.demo.url, { storedConsent: "all" });
    await s.page.goto(env.demo.url + "/thank-you.html?order=NW-00000000");
    await s.page.waitForSelector("#no-order");
    await s.harness.quiesce(300);
    expect(purchases(s)).toHaveLength(0);
  });

  it("documented limit: the guard is per tab session, so clearing sessionStorage lets it fire again", async () => {
    const { s } = await placeOrder();
    await s.page.evaluate(() => sessionStorage.removeItem("nw_purchases_sent"));
    await s.page.reload();
    await s.page.waitForSelector("#order-id");
    await s.harness.quiesce(300);
    expect(purchases(s)).toHaveLength(2);
  });
});

