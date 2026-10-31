import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFunnel } from "../src/funnel.js";
import { loadContainer } from "../src/harness.js";
import { validate } from "../src/validator.js";
import { hitsFor, newSession, startEnv, type Env } from "./helpers.js";

let env: Env;
beforeAll(async () => { env = await startEnv(); });
afterAll(async () => { await env.close(); });

async function runWith(mutate: (c: any) => void) {
  const container = loadContainer() as any;
  mutate(container);
  const s = await newSession(env, env.demo.url, { storedConsent: "all", container });
  await walkFunnel(s.page, s.harness, env.demo.url);
  return s;
}

describe("the container export drives what is sent (through the GTM emulator)", () => {
  it("without the purchase tag no purchase hit is sent, and the kit validator notices", async () => {
    const s = await runWith((c) => {
      c.containerVersion.tag = c.containerVersion.tag.filter((t: any) => t.name !== "GA4 - Event - purchase");
    });
    expect(hitsFor(s.capture, "purchase")).toHaveLength(0);
    expect(hitsFor(s.capture, "add_to_cart").length).toBeGreaterThan(0);
    const r = validate(s.capture, { expectHits: true }).find((x) => x.id === "hits-match-events")!;
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("purchase: 1 push(es), 0 hit(s)");
  });

  it("a mapping that points at the wrong dataLayer path loses the transaction id, and the validator notices", async () => {
    const s = await runWith((c) => {
      const v = c.containerVersion.variable.find((x: any) => x.name === "DLV - ecommerce.transaction_id");
      v.parameter.find((p: any) => p.key === "name").value = "ecommerce.transactionId";
    });
    const [h] = hitsFor(s.capture, "purchase");
    expect(h!.params["ep.transaction_id"]).toBeUndefined();
    expect(validate(s.capture, { expectHits: true }).find((x) => x.id === "hit-params")!.status).toBe("fail");
  });

  it("a tag that requires ad_storage never fires for a visitor who only granted analytics", async () => {
    const container = loadContainer() as any;
    const tag = container.containerVersion.tag.find((t: any) => t.name === "GA4 - Event - view_cart");
    tag.consentSettings.consentType.list = [{ type: "TEMPLATE", value: "ad_storage" }];
    const s = await newSession(env, env.demo.url, { storedConsent: "analytics", container });
    await walkFunnel(s.page, s.harness, env.demo.url);
    expect(hitsFor(s.capture, "view_cart")).toHaveLength(0);
    expect(hitsFor(s.capture, "add_to_cart").length).toBeGreaterThan(0);
  });

  it("tags with no consent settings of their own still stop sending once analytics consent is withdrawn (built-in check)", async () => {
    const container = loadContainer() as any;
    for (const t of container.containerVersion.tag) delete t.consentSettings;
    const s = await newSession(env, env.demo.url, { storedConsent: "all", container });
    await s.page.goto(env.demo.url + "/product.html?id=NW-HERB-3");
    await s.harness.quiesce(300);
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(hitsFor(s.capture, "add_to_cart")).toHaveLength(1);
    await s.page.click("#cookie-settings");
    await s.page.click("#consent-reject");
    await s.harness.quiesce(300);
    const before = s.capture.hits.length;
    await s.page.click("#add-to-cart");
    await s.harness.quiesce(300);
    expect(s.capture.hits).toHaveLength(before);
  });

  it("the committed container sends all nine events with the committed placeholders", async () => {
    const s = await runWith(() => {});
    const names = new Set(s.capture.hits.map((h) => h.params.en));
    for (const n of ["view_item_list", "view_item", "add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase", "page_view"]) expect(names.has(n), n).toBe(true);
    expect(new Set(s.capture.hits.map((h) => h.params.tid))).toEqual(new Set(["G-XXXXXXXXXX"]));
    expect(new Set(s.capture.hits.map((h) => h.params.gtm))).toEqual(new Set(["GTM-XXXXXXX"]));
  });
});
