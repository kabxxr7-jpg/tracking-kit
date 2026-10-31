import type { Capture, CheckResult, Hit, Push, ValuePolicy } from "./types.js";

/** Canonical funnel order, used for the order check. remove_from_cart is not part of the sequence. */
export const FUNNEL_ORDER = [
  "view_item_list",
  "view_item",
  "add_to_cart",
  "view_cart",
  "begin_checkout",
  "add_shipping_info",
  "add_payment_info",
  "purchase"
] as const;
export const ECOMMERCE_EVENTS = [...FUNNEL_ORDER, "remove_from_cart"] as const;
export type EcommerceEvent = (typeof ECOMMERCE_EVENTS)[number];

const CONSENT_TYPES = ["ad_storage", "analytics_storage", "ad_user_data", "ad_personalization"] as const;

/** Parameters Google documents for each event (plus tax and shipping on purchase, which this kit requires). */
const REQUIRED: Record<EcommerceEvent, string[]> = {
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
/** Events whose items must carry quantity. */
const QUANTITY_REQUIRED = new Set<string>(["add_to_cart", "remove_from_cart", "view_cart", "begin_checkout", "add_shipping_info", "add_payment_info", "purchase"]);

export interface ValidateOptions {
  valuePolicy?: ValuePolicy;
  /** True when the harness emulated GTM, so hits are expected for every event pushed after consent. */
  expectHits?: boolean;
  /** Fail when any funnel event is missing (used for the scripted walk). */
  requireFunnel?: boolean;
  /** Exact strings that must not appear anywhere in pushes or hits (for example the test email). */
  piiValues?: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const cents = (n: number) => Math.round(n * 100);

export interface EcomEvent {
  push: Push;
  name: string;
  ecommerce: Obj;
  position: number;
}

function objectPushes(c: Capture): Push[] {
  return c.pushes.filter((p) => p.kind === "object");
}

export function ecommerceEvents(c: Capture): EcomEvent[] {
  const all = c.pushes;
  const out: EcomEvent[] = [];
  all.forEach((p, position) => {
    if (p.kind !== "object" || !isObj(p.data)) return;
    const name = p.data.event;
    if (typeof name !== "string" || !(ECOMMERCE_EVENTS as readonly string[]).includes(name)) return;
    out.push({ push: p, name, ecommerce: isObj(p.data.ecommerce) ? p.data.ecommerce : {}, position });
  });
  return out;
}

interface ConsentCommand { seq: number; kind: "default" | "update"; values: Record<string, string>; region: boolean }
function consentCommands(c: Capture): ConsentCommand[] {
  const out: ConsentCommand[] = [];
  for (const p of c.pushes) {
    if (p.kind !== "command" || !Array.isArray(p.data)) continue;
    const [a, b, values] = p.data as unknown[];
    if (a === "consent" && (b === "default" || b === "update") && isObj(values)) {
      out.push({ seq: p.seq, kind: b, values: values as Record<string, string>, region: "region" in values });
    }
  }
  return out;
}
/** Consent state (unset counts as granted, like GTM) replayed up to `seq`. */
function consentAt(cmds: ConsentCommand[], seq: number): Record<string, string> {
  const state: Record<string, string> = {};
  for (const cmd of cmds) {
    if (cmd.seq > seq || cmd.region) continue;
    for (const [k, v] of Object.entries(cmd.values)) if (typeof v === "string") state[k] = v;
  }
  return state;
}
const granted = (state: Record<string, string>, type: string) => state[type] !== "denied";

function result(id: string, title: string, status: CheckResult["status"], detail: string): CheckResult {
  return { id, title, status, detail };
}
const label = (e: EcomEvent) => `${e.name}#${e.push.seq}`;
const joined = (xs: string[], max = 6) => (xs.length > max ? `${xs.slice(0, max).join("; ")}; and ${xs.length - max} more` : xs.join("; "));

function maskEmail(s: string): string {
  return s.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, "$1***@$2");
}
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PII_KEY_RE = /^(e-?mail|user_?e-?mail|customer_?e-?mail|phone|telephone|first_?name|last_?name|full_?name|street|address|postcode|postal_?code|zip)$/i;

function walkStrings(value: unknown, path: string, visit: (path: string, key: string | null, text: string) => void, key: string | null = null): void {
  if (typeof value === "string") visit(path, key, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit, key));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) walkStrings(v, path ? `${path}.${k}` : k, visit, k);
}
function walkKeys(value: unknown, path: string, visit: (path: string, key: string) => void): void {
  if (Array.isArray(value)) value.forEach((v, i) => walkKeys(v, `${path}[${i}]`, visit));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) { visit(path ? `${path}.${k}` : k, k); walkKeys(v, path ? `${path}.${k}` : k, visit); }
}
function decode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

export function validate(capture: Capture, options: ValidateOptions = {}): CheckResult[] {
  const policy: ValuePolicy = options.valuePolicy ?? "items+tax+shipping";
  const events = ecommerceEvents(capture);
  const cmds = consentCommands(capture);
  const results: CheckResult[] = [];
  const noEvents = events.length === 0;

  // 1. consent default ---------------------------------------------------------------------------
  {
    const id = "consent-default";
    const title = "Consent Mode v2 default is denied for all four types before any tag loads";
    const defaults = cmds.filter((c) => c.kind === "default" && !c.region);
    if (capture.pushes.length === 0 && capture.hits.length === 0) {
      results.push(result(id, title, "skip", "No dataLayer activity was recorded."));
    } else if (defaults.length === 0) {
      results.push(result(id, title, "fail", "No gtag('consent','default', ...) command found. Without a default, consent types count as granted."));
    } else {
      const state = consentAt(defaults, Infinity);
      const notDenied = CONSENT_TYPES.filter((t) => state[t] !== "denied");
      const firstDefault = Math.min(...defaults.map((d) => d.seq));
      const tagStarts = [
        ...capture.pushes.filter((p) => p.kind === "object" && isObj(p.data) && ("gtm.start" in p.data || p.data.event === "gtm.js")).map((p) => p.seq),
        ...capture.scripts.map((s) => s.seq),
        ...capture.hits.map((h) => h.seq)
      ];
      const early = tagStarts.filter((s) => s < firstDefault).length;
      if (notDenied.length) results.push(result(id, title, "fail", `Default is not 'denied' for: ${notDenied.join(", ")}.`));
      else if (early) results.push(result(id, title, "fail", `The default was set after ${early} tag load or hit event(s).`));
      else results.push(result(id, title, "pass", "All four types are denied by default and the default comes first."));
    }
  }

  // 2. no hits before consent ---------------------------------------------------------------------
  {
    const id = "no-hits-before-consent";
    const title = "No analytics hit is sent before analytics_storage is granted";
    const hitsWithEvent = capture.hits;
    if (hitsWithEvent.length === 0) {
      results.push(result(id, title, "pass", "No analytics hits were recorded."));
    } else {
      const bad = hitsWithEvent.filter((h) => !granted(consentAt(cmds, h.seq), "analytics_storage") || !cmds.some((c) => c.seq < h.seq && c.kind === "update" && c.values.analytics_storage === "granted"));
      if (bad.length) {
        const names = bad.map((h) => h.params.en ?? "hit");
        results.push(result(id, title, "fail", `${bad.length} hit(s) were sent before analytics consent was granted: ${joined(names)}.`));
      } else {
        results.push(result(id, title, "pass", `${hitsWithEvent.length} hit(s), all after analytics_storage was granted.`));
      }
    }
  }

  // 3. ecommerce cleared --------------------------------------------------------------------------
  {
    const id = "ecommerce-cleared";
    const title = "Each ecommerce push is preceded by { ecommerce: null }";
    if (noEvents) results.push(result(id, title, "skip", "No ecommerce events were pushed."));
    else {
      const bad = events.filter((e) => {
        const prev = capture.pushes[e.position - 1];
        return !(prev && prev.kind === "object" && isObj(prev.data) && "ecommerce" in prev.data && prev.data.ecommerce === null && Object.keys(prev.data).length === 1);
      });
      results.push(bad.length
        ? result(id, title, "fail", `Not cleared before: ${joined(bad.map(label))}. Stale values from the previous event can leak into these.`)
        : result(id, title, "pass", `${events.length} ecommerce push(es), each cleared first.`));
    }
  }

  // 4. required params ----------------------------------------------------------------------------
  {
    const id = "required-params";
    const title = "Every event carries the parameters Google documents for it";
    if (noEvents) results.push(result(id, title, "skip", "No ecommerce events were pushed."));
    else {
      const problems: string[] = [];
      for (const e of events) {
        const missing = REQUIRED[e.name as EcommerceEvent].filter((k) => {
          const v = e.ecommerce[k];
          return v === undefined || v === null || v === "" || (k === "items" && (!Array.isArray(v) || v.length === 0));
        });
        if (missing.length) problems.push(`${label(e)} missing ${missing.join(", ")}`);
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", `${events.length} event(s) checked.`));
    }
  }

  // 5. items --------------------------------------------------------------------------------------
  {
    const id = "items-valid";
    const title = "Items have item_id, item_name, a numeric price and (where needed) an integer quantity";
    if (noEvents) results.push(result(id, title, "skip", "No ecommerce events were pushed."));
    else {
      const problems: string[] = [];
      for (const e of events) {
        const items = e.ecommerce.items;
        if (!Array.isArray(items)) continue;
        items.forEach((it, i) => {
          if (!isObj(it)) { problems.push(`${label(e)} item ${i} is not an object`); return; }
          const bad: string[] = [];
          if (typeof it.item_id !== "string" || it.item_id === "") bad.push("item_id");
          if (typeof it.item_name !== "string" || it.item_name === "") bad.push("item_name");
          if (typeof it.price !== "number" || !Number.isFinite(it.price) || it.price < 0) bad.push("price (must be a number)");
          if (QUANTITY_REQUIRED.has(e.name) && !(typeof it.quantity === "number" && Number.isInteger(it.quantity) && it.quantity >= 1)) bad.push("quantity (integer >= 1)");
          if (bad.length) problems.push(`${label(e)} item ${i}: ${bad.join(", ")}`);
        });
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", "All items valid."));
    }
  }

  // 6. value types --------------------------------------------------------------------------------
  {
    const id = "numeric-values";
    const title = "value, tax and shipping are numbers (no strings, no currency symbols)";
    if (noEvents) results.push(result(id, title, "skip", "No ecommerce events were pushed."));
    else {
      const problems: string[] = [];
      for (const e of events) {
        for (const k of ["value", "tax", "shipping"]) {
          const v = e.ecommerce[k];
          if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v))) problems.push(`${label(e)} ${k} is ${typeof v} ${JSON.stringify(v)}`);
        }
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", "All monetary parameters are numbers."));
    }
  }

  // 7. currency -----------------------------------------------------------------------------------
  {
    const id = "currency";
    const title = "currency is a 3-letter ISO 4217 code and the same on every event";
    const withValue = events.filter((e) => e.ecommerce.value !== undefined || e.ecommerce.currency !== undefined);
    if (withValue.length === 0) results.push(result(id, title, "skip", "No ecommerce events with a value were pushed."));
    else {
      const problems: string[] = [];
      const seen = new Set<string>();
      for (const e of withValue) {
        const c = e.ecommerce.currency;
        if (typeof c !== "string" || !/^[A-Z]{3}$/.test(c)) problems.push(`${label(e)} currency ${JSON.stringify(c)}`);
        else seen.add(c);
      }
      if (seen.size > 1) problems.push(`mixed currencies: ${[...seen].join(", ")}`);
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", `Currency ${[...seen].join(", ")} on ${withValue.length} event(s).`));
    }
  }

  // 8. value math ---------------------------------------------------------------------------------
  {
    const id = "value-math";
    const title = policy === "items+tax+shipping"
      ? "value equals the sum of items (purchase: plus tax and shipping)"
      : "value equals the sum of items price x quantity (tax and shipping excluded)";
    const checkable = events.filter((e) => typeof e.ecommerce.value === "number" && Array.isArray(e.ecommerce.items) && e.ecommerce.items.length > 0);
    if (checkable.length === 0) results.push(result(id, title, "skip", "No events with a numeric value and items."));
    else {
      const problems: string[] = [];
      for (const e of checkable) {
        const items = e.ecommerce.items as unknown[];
        let sum = 0;
        let ok = true;
        for (const it of items) {
          if (!isObj(it) || typeof it.price !== "number") { ok = false; break; }
          sum += cents(it.price) * (typeof it.quantity === "number" ? it.quantity : 1);
        }
        if (!ok) continue; // reported by items-valid
        let expected = sum;
        if (e.name === "purchase" && policy === "items+tax+shipping") {
          const tax = typeof e.ecommerce.tax === "number" ? cents(e.ecommerce.tax) : 0;
          const ship = typeof e.ecommerce.shipping === "number" ? cents(e.ecommerce.shipping) : 0;
          expected += tax + ship;
        }
        const actual = cents(e.ecommerce.value as number);
        if (actual !== expected) problems.push(`${label(e)} value ${(actual / 100).toFixed(2)}, expected ${(expected / 100).toFixed(2)}`);
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", `${checkable.length} event(s) add up.`));
    }
  }

  // 9. purchase once ------------------------------------------------------------------------------
  {
    const id = "purchase-once";
    const title = "Each transaction_id is reported by exactly one purchase event";
    const purchases = events.filter((e) => e.name === "purchase");
    if (purchases.length === 0) results.push(result(id, title, "skip", "No purchase event was pushed."));
    else {
      const counts = new Map<string, number>();
      for (const p of purchases) {
        const tid = typeof p.ecommerce.transaction_id === "string" ? p.ecommerce.transaction_id : "(missing)";
        counts.set(tid, (counts.get(tid) ?? 0) + 1);
      }
      const dups = [...counts].filter(([, n]) => n > 1).map(([tid, n]) => `${tid} x${n}`);
      results.push(dups.length ? result(id, title, "fail", `Duplicate purchase: ${dups.join(", ")}.`) : result(id, title, "pass", `${purchases.length} purchase(s), all distinct.`));
    }
  }

  // 10. order -------------------------------------------------------------------------------------
  {
    const id = "event-order";
    const title = "Funnel events first appear in order (list, item, cart, checkout, shipping, payment, purchase)";
    const firsts = FUNNEL_ORDER.map((n) => ({ n, e: events.find((e) => e.name === n) })).filter((x): x is { n: (typeof FUNNEL_ORDER)[number]; e: EcomEvent } => !!x.e);
    if (firsts.length < 2) results.push(result(id, title, "skip", "Fewer than two funnel events were pushed."));
    else {
      const problems: string[] = [];
      for (let i = 1; i < firsts.length; i++) {
        if (firsts[i]!.e.push.seq < firsts[i - 1]!.e.push.seq) problems.push(`${firsts[i]!.n} came before ${firsts[i - 1]!.n}`);
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", firsts.map((f) => f.n).join(" > ")));
    }
  }

  // 11. funnel complete ---------------------------------------------------------------------------
  if (options.requireFunnel) {
    const id = "funnel-complete";
    const title = "Every ecommerce event of the funnel was pushed";
    const have = new Set(events.map((e) => e.name));
    const missing = ECOMMERCE_EVENTS.filter((n) => !have.has(n));
    results.push(missing.length ? result(id, title, "fail", `Missing: ${missing.join(", ")}.`) : result(id, title, "pass", `All ${ECOMMERCE_EVENTS.length} events seen.`));
  }

  // 12. PII ---------------------------------------------------------------------------------------
  {
    const id = "no-pii";
    const title = "No email address or personal field appears in dataLayer pushes or analytics hits";
    const found: string[] = [];
    const pushesToScan = capture.pushes.filter((p) => p.kind === "object");
    for (const p of pushesToScan) {
      walkStrings(p.data, "", (path, _key, text) => {
        if (EMAIL_RE.test(text)) found.push(`dataLayer push #${p.seq} ${path}: ${maskEmail(text)}`);
        for (const v of options.piiValues ?? []) if (v && text.includes(v)) found.push(`dataLayer push #${p.seq} ${path}: contains a supplied personal value`);
      });
      walkKeys(p.data, "", (path, key) => { if (PII_KEY_RE.test(key)) found.push(`dataLayer push #${p.seq} has a personal field name: ${path}`); });
    }
    for (const h of capture.hits) {
      for (const [k, v] of Object.entries(h.params)) {
        const text = decode(v);
        if (EMAIL_RE.test(text)) found.push(`hit #${h.seq} (${h.params.en ?? "hit"}) param ${k}: ${maskEmail(text)}`);
        for (const pv of options.piiValues ?? []) if (pv && text.includes(pv)) found.push(`hit #${h.seq} param ${k}: contains a supplied personal value`);
      }
    }
    const unique = [...new Set(found)];
    if (pushesToScan.length === 0 && capture.hits.length === 0) results.push(result(id, title, "skip", "Nothing recorded to scan."));
    else results.push(unique.length ? result(id, title, "fail", joined(unique)) : result(id, title, "pass", `${pushesToScan.length} push(es) and ${capture.hits.length} hit(s) scanned.`));
  }

  // 13/14. hit level (only when GTM was emulated) -------------------------------------------------
  if (options.expectHits) {
    {
      const id = "hits-match-events";
      const title = "Every event pushed after consent produced exactly one matching hit";
      const problems: string[] = [];
      for (const name of ECOMMERCE_EVENTS) {
        const pushed = events.filter((e) => e.name === name && granted(consentAt(cmds, e.push.seq), "analytics_storage") && cmds.some((c) => c.seq < e.push.seq && c.kind === "update" && c.values.analytics_storage === "granted")).length;
        const hits = capture.hits.filter((h) => h.params.en === name).length;
        if (pushed !== hits) problems.push(`${name}: ${pushed} push(es), ${hits} hit(s)`);
      }
      results.push(problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", "Push and hit counts agree for every event."));
    }
    {
      const id = "hit-params";
      const title = "Ecommerce hits carry numeric value (epn.value), currency (cu) and, for purchase, transaction_id";
      const problems: string[] = [];
      const ecomHits = capture.hits.filter((h) => (ECOMMERCE_EVENTS as readonly string[]).includes(h.params.en ?? "") && h.params.en !== "view_item_list");
      for (const h of ecomHits) {
        const en = h.params.en!;
        if (h.params["epn.value"] === undefined) problems.push(`${en} hit #${h.seq} has no numeric value${h.params["ep.value"] !== undefined ? ` (sent as text: ${h.params["ep.value"]})` : ""}`);
        if (!h.params.cu) problems.push(`${en} hit #${h.seq} has no currency`);
        if (en === "purchase" && !h.params["ep.transaction_id"]) problems.push(`purchase hit #${h.seq} has no transaction_id`);
      }
      results.push(ecomHits.length === 0
        ? result(id, title, "skip", "No ecommerce hits to check.")
        : problems.length ? result(id, title, "fail", joined(problems)) : result(id, title, "pass", `${ecomHits.length} hit(s) checked.`));
    }
  }

  return results;
}

export function summarize(results: CheckResult[]): { pass: number; fail: number; skip: number } {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length
  };
}

export type { Hit };
