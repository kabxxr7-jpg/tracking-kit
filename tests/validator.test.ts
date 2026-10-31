import { describe, expect, it } from "vitest";
import { summarize, validate } from "../src/validator.js";
import type { Capture, Hit, Push } from "../src/types.js";

/** Builds a synthetic capture so each check can be pushed over its edge without a browser. */
class Builder {
  seq = 0;
  c: Capture = { pushes: [], hits: [], scripts: [], blocked: [] };
  consentDefault(values: Record<string, string> = { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" }) {
    return this.cmd(["consent", "default", values]);
  }
  consentUpdate(values: Record<string, string> = { analytics_storage: "granted" }) {
    return this.cmd(["consent", "update", values]);
  }
  cmd(args: unknown[]) {
    this.c.pushes.push({ seq: ++this.seq, page: "p", kind: "command", data: args } as Push);
    return this;
  }
  obj(data: unknown) {
    this.c.pushes.push({ seq: ++this.seq, page: "p", kind: "object", data } as Push);
    return this;
  }
  event(event: string, ecommerce: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    this.obj({ ecommerce: null });
    return this.obj({ event, ecommerce, ...extra });
  }
  hit(params: Record<string, string>) {
    const h: Hit = { seq: ++this.seq, page: "p", host: "www.google-analytics.com", method: "POST", url: "https://www.google-analytics.com/g/collect?" + new URLSearchParams(params), params };
    this.c.hits.push(h);
    return this;
  }
  script() {
    this.c.scripts.push({ seq: ++this.seq, url: "https://www.googletagmanager.com/gtm.js", served: "emulator" });
    return this;
  }
}

const item = (over: Record<string, unknown> = {}) => ({ item_id: "A1", item_name: "Pot", price: 10, quantity: 2, ...over });
const status = (b: Builder, id: string, opts = {}) => validate(b.c, opts).find((r) => r.id === id)?.status;
const detail = (b: Builder, id: string, opts = {}) => validate(b.c, opts).find((r) => r.id === id)?.detail ?? "";

const good = () => new Builder().consentDefault().consentUpdate().event("add_to_cart", { currency: "USD", value: 20, items: [item()] });

describe("consent-default", () => {
  it("passes when all four types are denied before the first tag script", () => {
    expect(status(new Builder().consentDefault().script(), "consent-default")).toBe("pass");
  });
  it("fails when there is no default at all", () => {
    expect(status(new Builder().obj({ event: "gtm.js" }), "consent-default")).toBe("fail");
  });
  it("fails when one type is granted by default", () => {
    const b = new Builder().consentDefault({ ad_storage: "denied", analytics_storage: "granted", ad_user_data: "denied", ad_personalization: "denied" });
    expect(detail(b, "consent-default")).toContain("analytics_storage");
  });
  it("fails when a type is missing from the default (v2 needs all four)", () => {
    expect(status(new Builder().consentDefault({ ad_storage: "denied", analytics_storage: "denied" }), "consent-default")).toBe("fail");
  });
  it("fails when the default arrives after the tag manager was requested", () => {
    expect(status(new Builder().script().consentDefault(), "consent-default")).toBe("fail");
  });
  it("is skipped for an empty capture", () => {
    expect(status(new Builder(), "consent-default")).toBe("skip");
  });
});

describe("no-hits-before-consent", () => {
  it("passes with no hits", () => expect(status(new Builder().consentDefault(), "no-hits-before-consent")).toBe("pass"));
  it("passes when the hit follows an analytics grant", () => {
    expect(status(new Builder().consentDefault().consentUpdate().hit({ en: "page_view" }), "no-hits-before-consent")).toBe("pass");
  });
  it("fails when the hit comes first", () => {
    expect(status(new Builder().consentDefault().hit({ en: "page_view" }).consentUpdate(), "no-hits-before-consent")).toBe("fail");
  });
  it("fails when hits exist and consent was never granted", () => {
    expect(status(new Builder().consentDefault().hit({ en: "page_view" }), "no-hits-before-consent")).toBe("fail");
  });
  it("fails when only ad storage was granted and an analytics hit was sent", () => {
    expect(status(new Builder().consentDefault().consentUpdate({ ad_storage: "granted" }).hit({ en: "page_view" }), "no-hits-before-consent")).toBe("fail");
  });
  it("fails when consent was granted and then withdrawn before the hit", () => {
    const b = new Builder().consentDefault().consentUpdate().consentUpdate({ analytics_storage: "denied" }).hit({ en: "page_view" });
    expect(status(b, "no-hits-before-consent")).toBe("fail");
  });
});

describe("ecommerce-cleared", () => {
  it("passes for the normal null-then-event pattern", () => expect(status(good(), "ecommerce-cleared")).toBe("pass"));
  it("fails when the previous push was not the null reset", () => {
    const b = new Builder().obj({ event: "add_to_cart", ecommerce: { currency: "USD", value: 20, items: [item()] } });
    expect(status(b, "ecommerce-cleared")).toBe("fail");
  });
  it("fails when the reset push carries other keys too", () => {
    const b = new Builder().obj({ ecommerce: null, page: "x" }).obj({ event: "add_to_cart", ecommerce: { currency: "USD", value: 20, items: [item()] } });
    expect(status(b, "ecommerce-cleared")).toBe("fail");
  });
  it("is skipped when there are no ecommerce events", () => expect(status(new Builder().consentDefault(), "ecommerce-cleared")).toBe("skip"));
});

describe("required-params", () => {
  it("fails when purchase lacks transaction_id", () => {
    const b = new Builder().event("purchase", { currency: "USD", value: 20, tax: 0, shipping: 0, items: [item()] });
    expect(detail(b, "required-params")).toContain("transaction_id");
  });
  it("fails when purchase lacks tax and shipping", () => {
    const b = new Builder().event("purchase", { transaction_id: "T1", currency: "USD", value: 20, items: [item()] });
    expect(detail(b, "required-params")).toMatch(/tax, shipping/);
  });
  it("accepts tax and shipping of 0", () => {
    const b = new Builder().event("purchase", { transaction_id: "T1", currency: "USD", value: 20, tax: 0, shipping: 0, items: [item()] });
    expect(status(b, "required-params")).toBe("pass");
  });
  it("fails on an empty items array", () => {
    expect(status(new Builder().event("view_cart", { currency: "USD", value: 0, items: [] }), "required-params")).toBe("fail");
  });
  it("fails when add_shipping_info lacks shipping_tier and add_payment_info lacks payment_type", () => {
    const b = new Builder()
      .event("add_shipping_info", { currency: "USD", value: 20, items: [item()] })
      .event("add_payment_info", { currency: "USD", value: 20, items: [item()] });
    const d = detail(b, "required-params");
    expect(d).toContain("shipping_tier");
    expect(d).toContain("payment_type");
  });
  it("view_item_list only needs items", () => {
    expect(status(new Builder().event("view_item_list", { items: [item({ quantity: undefined })] }), "required-params")).toBe("pass");
  });
});

describe("items-valid", () => {
  it("fails on a missing item_id", () => expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item({ item_id: undefined })] }), "items-valid")).toBe("fail"));
  it("fails on an empty item_name", () => expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item({ item_name: "" })] }), "items-valid")).toBe("fail"));
  it("fails on a string price", () => expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item({ price: "10.00" })] }), "items-valid")).toBe("fail"));
  it("fails on a missing or fractional quantity in the cart stage", () => {
    expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 10, items: [item({ quantity: undefined })] }), "items-valid")).toBe("fail");
    expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 15, items: [item({ quantity: 1.5 })] }), "items-valid")).toBe("fail");
  });
  it("allows a list item without quantity", () => {
    expect(status(new Builder().event("view_item_list", { items: [item({ quantity: undefined })] }), "items-valid")).toBe("pass");
  });
});

describe("numeric-values and currency", () => {
  it("fails on value as a string with a currency symbol", () => {
    expect(detail(new Builder().event("purchase", { transaction_id: "T", currency: "USD", value: "$20.00", tax: 0, shipping: 0, items: [item()] }), "numeric-values")).toContain("$20.00");
  });
  it("fails on tax as a numeric string", () => {
    expect(status(new Builder().event("purchase", { transaction_id: "T", currency: "USD", value: 20, tax: "0", shipping: 0, items: [item()] }), "numeric-values")).toBe("fail");
  });
  it("fails on a missing, lower-case or symbol currency", () => {
    for (const currency of [undefined, "usd", "$", "US"]) {
      expect(status(new Builder().event("add_to_cart", { currency, value: 20, items: [item()] }), "currency"), String(currency)).toBe("fail");
    }
  });
  it("fails when two currencies are mixed", () => {
    const b = new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item()] }).event("view_cart", { currency: "EUR", value: 20, items: [item()] });
    expect(detail(b, "currency")).toContain("mixed");
  });
});

describe("value-math", () => {
  const purchase = (value: number, tax = 1.6, shipping = 4.95) =>
    new Builder().event("purchase", { transaction_id: "T", currency: "USD", value, tax, shipping, items: [item()] });
  // Default policy = Google's reference: value is the sum of price x quantity, tax and shipping are NOT included.
  it("default policy: value of items only passes (20 with tax 1.60 and shipping 4.95 kept in their own parameters)", () => {
    expect(status(purchase(20), "value-math")).toBe("pass");
    expect(validate(purchase(20).c).find((r) => r.id === "value-math")!.title).toContain("Google's reference");
  });
  it("default policy: value that includes tax and shipping fails, and the message says Google leaves them out", () => {
    const d = detail(purchase(26.55), "value-math");
    expect(d).toContain("value 26.55, expected 20.00");
    expect(d).toContain("Google says to leave them out");
  });
  it("default policy: value that includes only shipping fails too", () => expect(status(purchase(24.95), "value-math")).toBe("fail"));
  it("explicit 'items' policy behaves like the default", () => {
    expect(status(purchase(20), "value-math", { valuePolicy: "items" })).toBe("pass");
    expect(status(purchase(26.55), "value-math", { valuePolicy: "items" })).toBe("fail");
  });
  // Opt-in policy, NOT Google's guidance.
  it("opt-in items+tax+shipping policy: 20 + 1.60 + 4.95 = 26.55 passes and its title says it is not Google's guidance", () => {
    expect(status(purchase(26.55), "value-math", { valuePolicy: "items+tax+shipping" })).toBe("pass");
    expect(validate(purchase(26.55).c, { valuePolicy: "items+tax+shipping" }).find((r) => r.id === "value-math")!.title).toContain("NOT Google's guidance");
  });
  it("opt-in items+tax+shipping policy: value of items only fails and names the expected figure", () => {
    expect(detail(purchase(20), "value-math", { valuePolicy: "items+tax+shipping" })).toContain("expected 26.55");
  });
  it("the policy only changes purchase: cart-stage events are items only under both policies", () => {
    const b = new Builder().event("begin_checkout", { currency: "USD", value: 26.55, items: [item()] });
    expect(status(b, "value-math")).toBe("fail");
    expect(status(b, "value-math", { valuePolicy: "items+tax+shipping" })).toBe("fail");
  });
  it("is exact to the cent (no float drift: 0.1 x 3)", () => {
    const b = new Builder().event("add_to_cart", { currency: "USD", value: 0.3, items: [item({ price: 0.1, quantity: 3 })] });
    expect(status(b, "value-math")).toBe("pass");
  });
  it("cart events: value must equal the items sum", () => {
    expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 19.99, items: [item()] }), "value-math")).toBe("fail");
  });
  it("treats a missing quantity as 1", () => {
    expect(status(new Builder().event("view_item", { currency: "USD", value: 10, items: [item({ quantity: undefined })] }), "value-math")).toBe("pass");
  });
});

describe("purchase-once and event-order", () => {
  const p = (tid: string) => ({ transaction_id: tid, currency: "USD", value: 20, tax: 0, shipping: 0, items: [item()] });
  it("two different transactions pass", () => expect(status(new Builder().event("purchase", p("A")).event("purchase", p("B")), "purchase-once")).toBe("pass"));
  it("the same transaction twice fails and names it", () => {
    expect(detail(new Builder().event("purchase", p("A")).event("purchase", p("A")), "purchase-once")).toContain("A x2");
  });
  it("purchases without an id count as the same transaction", () => {
    expect(status(new Builder().event("purchase", { ...p("x"), transaction_id: undefined }).event("purchase", { ...p("x"), transaction_id: undefined }), "purchase-once")).toBe("fail");
  });
  it("order: cart before item fails", () => {
    const b = new Builder().event("view_cart", { currency: "USD", value: 20, items: [item()] }).event("view_item", { currency: "USD", value: 20, items: [item()] });
    expect(detail(b, "event-order")).toContain("view_cart came before view_item");
  });
  it("order: purchase before add_payment_info fails", () => {
    const b = new Builder().event("purchase", p("A")).event("add_payment_info", { currency: "USD", value: 20, payment_type: "x", items: [item()] });
    expect(status(b, "event-order")).toBe("fail");
  });
  it("order: repeated events later in the flow do not matter, only first appearances", () => {
    const b = new Builder()
      .event("view_item", { currency: "USD", value: 20, items: [item()] })
      .event("add_to_cart", { currency: "USD", value: 20, items: [item()] })
      .event("view_item", { currency: "USD", value: 20, items: [item()] });
    expect(status(b, "event-order")).toBe("pass");
  });
});

describe("no-pii", () => {
  it("fails on an email in an event field and masks it in the message", () => {
    const b = new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item()] }, { user_email: "jo.doe@example.test" });
    const d = detail(b, "no-pii");
    expect(d).toContain("j***@example.test");
    expect(d).not.toContain("jo.doe");
  });
  it("fails on an email nested inside items", () => {
    expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item({ item_variant: "gift for a@b.co" })] }), "no-pii")).toBe("fail");
  });
  it("fails on a personal field name even when its value is empty-looking", () => {
    expect(status(new Builder().event("add_to_cart", { currency: "USD", value: 20, items: [item()] }, { phone: "n/a" }), "no-pii")).toBe("fail");
  });
  it("fails on an email URL-encoded in a hit parameter", () => {
    const b = good().hit({ en: "page_view", dl: "https://shop.test/thanks?email=jo%40example.test" });
    expect(detail(b, "no-pii")).toContain("hit");
  });
  it("fails on a supplied personal value anywhere", () => {
    const b = good().hit({ en: "page_view", dt: "Order for Jo Doe" });
    expect(status(b, "no-pii", { piiValues: ["Jo Doe"] })).toBe("fail");
  });
  it("passes on clean data", () => expect(status(good().hit({ en: "page_view", dl: "https://shop.test/" }), "no-pii")).toBe("pass"));
});

describe("hit-level checks (only with expectHits)", () => {
  const pushed = () => good();
  it("are absent without expectHits", () => {
    expect(validate(pushed().c).some((r) => r.id === "hits-match-events")).toBe(false);
  });
  it("hits-match-events passes when each event has its hit", () => {
    const b = pushed().hit({ en: "add_to_cart", "epn.value": "20", cu: "USD" });
    expect(status(b, "hits-match-events", { expectHits: true })).toBe("pass");
  });
  it("hits-match-events fails on a missing hit", () => {
    expect(detail(pushed(), "hits-match-events", { expectHits: true })).toContain("add_to_cart: 1 push(es), 0 hit(s)");
  });
  it("hits-match-events fails on a duplicated hit", () => {
    const b = pushed().hit({ en: "add_to_cart", "epn.value": "20", cu: "USD" }).hit({ en: "add_to_cart", "epn.value": "20", cu: "USD" });
    expect(status(b, "hits-match-events", { expectHits: true })).toBe("fail");
  });
  it("hit-params fails when value went out as text", () => {
    const b = pushed().hit({ en: "add_to_cart", "ep.value": "$20.00", cu: "USD" });
    expect(detail(b, "hit-params", { expectHits: true })).toContain("sent as text");
  });
  it("hit-params fails on a purchase hit without a transaction id", () => {
    const b = new Builder().hit({ en: "purchase", "epn.value": "5", cu: "USD" });
    expect(detail(b, "hit-params", { expectHits: true })).toContain("transaction_id");
  });
});

describe("funnel-complete and summarize", () => {
  it("requireFunnel fails and names the missing events", () => {
    const d = detail(good(), "funnel-complete", { requireFunnel: true });
    expect(d).toContain("purchase");
    expect(d).not.toContain("add_to_cart");
  });
  it("summarize counts statuses", () => {
    expect(summarize([{ id: "a", title: "", status: "pass", detail: "" }, { id: "b", title: "", status: "fail", detail: "" }, { id: "c", title: "", status: "skip", detail: "" }])).toEqual({ pass: 1, fail: 1, skip: 1 });
  });
});
