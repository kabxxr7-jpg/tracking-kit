import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { walkFunnel, type WalkResult } from "../src/funnel.js";
import { validate } from "../src/validator.js";
import { cents, commands, ecomPushes, FUNNEL_EVENTS, hitsFor, newSession, objectPushes, startEnv, type Env, type Session } from "./helpers.js";

let env: Env;
let s: Session;
let walk: WalkResult;
const requestedHosts = new Set<string>();

beforeAll(async () => {
  env = await startEnv();
  s = await newSession(env, env.demo.url, { storedConsent: "all" });
  s.page.on("request", (r) => requestedHosts.add(new URL(r.url()).hostname));
  walk = await walkFunnel(s.page, s.harness, env.demo.url);
});
afterAll(async () => { await env.close(); });

const REQUIRED: Record<string, string[]> = {
  view_item_list: ["items"],
  view_item: ["currency", "value", "items"],
  add_to_cart: ["currency", "value", "items"],
  remove_from_cart: ["currency", "value", "items"],
  view_cart: ["currency", "value", "items"],
  begin_checkout: ["currency", "value", "items"],
  add_shipping_info: ["currency", "value", "items", "shipping_tier"],
  add_payment_info: ["currency", "value", "items", "payment_type"],
  purchase: ["transaction_id", "currency", "value", "tax", "shipping", "items"]
};

describe("demo store funnel (dataLayer)", () => {
  it("pushes the events in funnel order for the fixed basket", () => {
    expect(ecomPushes(s.capture).map((e) => e.name)).toEqual([
      "view_item_list",
      "view_item", "add_to_cart", "view_item", "add_to_cart", "view_item", "add_to_cart",
      "view_cart", "remove_from_cart",
      "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"
    ]);
  });

  it("covers all nine documented ecommerce events", () => {
    const seen = new Set(ecomPushes(s.capture).map((e) => e.name));
    expect([...seen].sort()).toEqual([...FUNNEL_EVENTS].sort());
  });

  it.each(Object.entries(REQUIRED))("%s carries its documented parameters", (name, keys) => {
    const events = ecomPushes(s.capture).filter((e) => e.name === name);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      for (const k of keys) expect(e.ecommerce[k], `${name}.${k}`).toBeDefined();
      expect(e.ecommerce.items.length).toBeGreaterThan(0);
    }
  });

  it("clears ecommerce with { ecommerce: null } immediately before every ecommerce push", () => {
    const pushes = s.capture.pushes;
    const ecommerceEvents = pushes.filter((p) => p.kind === "object" && FUNNEL_EVENTS.includes((p.data as any).event));
    for (const p of ecommerceEvents) {
      const prev = pushes[pushes.indexOf(p) - 1]!;
      expect(prev.data).toEqual({ ecommerce: null });
    }
  });

  it("every item has item_id, item_name, a numeric price and, outside lists, an integer quantity", () => {
    for (const e of ecomPushes(s.capture)) {
      for (const it of e.ecommerce.items) {
        expect(typeof it.item_id).toBe("string");
        expect(it.item_id.length).toBeGreaterThan(0);
        expect(typeof it.item_name).toBe("string");
        expect(typeof it.price).toBe("number");
        if (e.name !== "view_item_list") expect(Number.isInteger(it.quantity) && it.quantity >= 1).toBe(true);
      }
    }
  });

  it("purchase reports the right transaction, currency and amounts", () => {
    const [p] = ecomPushes(s.capture).filter((e) => e.name === "purchase");
    expect(p!.ecommerce.transaction_id).toBe(walk.transactionId);
    expect(p!.ecommerce.currency).toBe("USD");
    expect(p!.ecommerce.tax).toBe(5.64);
    expect(p!.ecommerce.shipping).toBe(11.95);
    expect(p!.ecommerce.value).toBe(88.09);
    expect(p!.ecommerce.items.map((i: any) => [i.item_id, i.quantity, i.price])).toEqual([
      ["NW-PLANT-12", 2, 18],
      ["NW-GLAZE-20", 1, 34.5]
    ]);
  });

  it("purchase value equals the sum of items plus tax plus shipping, computed independently", () => {
    const [p] = ecomPushes(s.capture).filter((e) => e.name === "purchase");
    const items = p!.ecommerce.items as Array<{ price: number; quantity: number }>;
    const itemsCents = items.reduce((sum, i) => sum + cents(i.price) * i.quantity, 0);
    expect(cents(p!.ecommerce.value)).toBe(itemsCents + cents(p!.ecommerce.tax) + cents(p!.ecommerce.shipping));
    expect(p!.ecommerce.value).toBe(walk.expected.value);
  });

  it("cart-stage events use the items subtotal as value", () => {
    for (const e of ecomPushes(s.capture).filter((x) => ["add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info"].includes(x.name))) {
      const sum = e.ecommerce.items.reduce((acc: number, i: any) => acc + cents(i.price) * i.quantity, 0);
      expect(cents(e.ecommerce.value), e.name).toBe(sum);
    }
  });

  it("add_shipping_info and add_payment_info carry what the shopper chose", () => {
    const ship = ecomPushes(s.capture).find((e) => e.name === "add_shipping_info")!;
    const pay = ecomPushes(s.capture).find((e) => e.name === "add_payment_info")!;
    expect(ship.ecommerce.shipping_tier).toBe("Express");
    expect(pay.ecommerce.payment_type).toBe("PayPal");
  });

  it("purchase fires exactly once", () => {
    expect(ecomPushes(s.capture).filter((e) => e.name === "purchase")).toHaveLength(1);
    expect(hitsFor(s.capture, "purchase")).toHaveLength(1);
  });

  it("the consent default is the very first dataLayer entry and denies all four types", () => {
    const first = s.capture.pushes[0]!;
    expect(first.kind).toBe("command");
    expect(first.data).toEqual(["consent", "default", {
      ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied"
    }]);
  });
});

describe("demo store funnel (requests to the fake collector)", () => {
  it("sends one hit per ecommerce event, in the same order as the dataLayer", () => {
    const pushed = ecomPushes(s.capture).map((e) => e.name);
    const hit = s.capture.hits.map((h) => h.params.en).filter((en) => en !== "page_view");
    expect(hit).toEqual(pushed);
  });

  it("the purchase hit carries transaction id, numeric value, tax, shipping, currency and items", () => {
    const [h] = hitsFor(s.capture, "purchase");
    expect(h!.host).toBe("www.google-analytics.com");
    expect(h!.params.tid).toBe("G-XXXXXXXXXX");
    expect(h!.params["ep.transaction_id"]).toBe(walk.transactionId);
    expect(h!.params["epn.value"]).toBe("88.09");
    expect(h!.params["epn.tax"]).toBe("5.64");
    expect(h!.params["epn.shipping"]).toBe("11.95");
    expect(h!.params.cu).toBe("USD");
    expect(h!.params.pr1).toContain("idNW-PLANT-12");
    expect(h!.params.pr1).toContain("qt2");
    expect(h!.params.pr2).toContain("idNW-GLAZE-20");
  });

  it("add_shipping_info and add_payment_info hits carry their own parameters", () => {
    expect(hitsFor(s.capture, "add_shipping_info")[0]!.params["ep.shipping_tier"]).toBe("Express");
    expect(hitsFor(s.capture, "add_payment_info")[0]!.params["ep.payment_type"]).toBe("PayPal");
  });

  it("every hit reports analytics and ads as granted (gcs G111) for a visitor who accepted all", () => {
    for (const h of s.capture.hits) expect(h.params.gcs).toBe("G111");
  });

  it("no personal data (email, name, address) appears in any push or any hit", () => {
    const blob = JSON.stringify(objectPushes(s.capture).map((p) => p.data)) + s.capture.hits.map((h) => decodeURIComponent(h.url.replace(/\+/g, " "))).join("\n");
    for (const secret of [walk.email, "Casey", "Example Street", "casey.example"]) expect(blob).not.toContain(secret);
  });

  it("nothing left the machine: only the two Google hostnames (both intercepted) and 127.0.0.1 were requested", () => {
    expect([...requestedHosts].sort()).toEqual(["127.0.0.1", "www.google-analytics.com", "www.googletagmanager.com"]);
    expect(s.capture.scripts.every((x) => x.served === "emulator")).toBe(true);
    expect(s.capture.blocked).toEqual([]);
  });

  it("the kit validator passes every check on this run", () => {
    const results = validate(s.capture, { expectHits: true, requireFunnel: true, piiValues: [walk.email, "Casey Example", "1 Example Street"] });
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
    expect(results.filter((r) => r.status === "pass").length).toBeGreaterThanOrEqual(13);
  });

  it("the first recorded push of the whole session is a consent default", () => {
    const defaults = commands(s.capture).filter((c) => c.args[0] === "consent" && c.args[1] === "default");
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults[0]!.seq).toBe(s.capture.pushes[0]!.seq);
  });
});
