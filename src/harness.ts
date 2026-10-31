import { readFileSync } from "node:fs";
import path from "node:path";
import type { BrowserContext, Route } from "playwright-core";
import { classify, type Mode } from "./policy.js";
import { ROOT } from "./server.js";
import type { Capture, Hit, Push } from "./types.js";

export type Container = Record<string, unknown>;

export const DEFAULT_CONTAINER_PATH = path.join(ROOT, "gtm", "container.json");
const EMULATOR_PATH = path.join(ROOT, "src", "emulator", "gtm-emulator.js");

export function loadContainer(file = DEFAULT_CONTAINER_PATH): Container {
  return JSON.parse(readFileSync(file, "utf8")) as Container;
}

/** Runs before any page script: records every dataLayer.push() argument and survives `window.dataLayer = []`. */
const RECORDER_SCRIPT = `
(function () {
  function rec(kind, value) {
    var json;
    try { json = JSON.stringify(value === undefined ? null : value); } catch (e) { json = JSON.stringify({ unserializable: true }); }
    try { window.__tkRecord(JSON.stringify({ kind: kind, page: location.href, json: json })); } catch (e) {}
  }
  function isArgs(v) { return Object.prototype.toString.call(v) === "[object Arguments]"; }
  function recordItem(item) { isArgs(item) || Array.isArray(item) ? rec("command", Array.prototype.slice.call(item)) : rec("object", item); }
  function patch(arr) {
    if (!Array.isArray(arr) || arr.__tkPatched) return arr;
    Object.defineProperty(arr, "__tkPatched", { value: true });
    arr.forEach(recordItem);
    var original = arr.push;
    arr.push = function () {
      for (var i = 0; i < arguments.length; i++) recordItem(arguments[i]);
      return original.apply(this, arguments);
    };
    return arr;
  }
  var current = patch([]);
  Object.defineProperty(window, "dataLayer", {
    configurable: true,
    get: function () { return current; },
    set: function (v) { current = patch(v); }
  });
})();
`;

function parseParams(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) out[k] = v;
  return out;
}

export interface HarnessOptions {
  mode: Mode;
  /** Host of the page under test; used to allow that one private host in external mode. */
  targetHost: string;
  container?: Container;
}

export class Harness {
  readonly capture: Capture = { pushes: [], hits: [], scripts: [], blocked: [] };
  private seq = 0;

  private constructor(private readonly opts: HarnessOptions) {}

  static async attach(context: BrowserContext, opts: HarnessOptions): Promise<Harness> {
    const h = new Harness(opts);
    await context.exposeBinding("__tkRecord", (_source, payload: string) => {
      const p = JSON.parse(payload) as { kind: "object" | "command"; page: string; json: string };
      const push: Push = { seq: ++h.seq, page: p.page, kind: p.kind, data: JSON.parse(p.json) };
      h.capture.pushes.push(push);
    });
    await context.addInitScript(RECORDER_SCRIPT);
    await context.route("**/*", (route) => h.handle(route));
    return h;
  }

  private emulatorSource(): string {
    const container = this.opts.container ?? loadContainer();
    return readFileSync(EMULATOR_PATH, "utf8").replace("__CONTAINER_JSON__", () => JSON.stringify(container));
  }

  private async handle(route: Route): Promise<void> {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const action = classify(url, method, this.opts.mode, this.opts.targetHost);
    switch (action.kind) {
      case "allow":
        if (this.opts.mode === "external" && /googletagmanager\.com/.test(url)) this.capture.scripts.push({ seq: ++this.seq, url, served: "real" });
        await route.continue();
        return;
      case "emulate-gtm":
        this.capture.scripts.push({ seq: ++this.seq, url, served: "emulator" });
        await route.fulfill({ status: 200, contentType: "application/javascript", body: this.emulatorSource() });
        return;
      case "stub-script":
        this.capture.scripts.push({ seq: ++this.seq, url, served: "stub" });
        await route.fulfill({ status: 200, contentType: "application/javascript", body: "/* tracking-kit stub */" });
        return;
      case "record-hit": {
        const u = new URL(url);
        const base = parseParams(u.search);
        const body = req.postData();
        const lines = body ? body.split(/\r?\n/).filter(Boolean) : [];
        const pageUrl = req.frame().url();
        const addHit = (params: Record<string, string>) => {
          const hit: Hit = { seq: ++this.seq, page: pageUrl, host: u.hostname, method, url, params };
          this.capture.hits.push(hit);
        };
        if (method === "POST" && lines.length > 0 && lines.every((l) => l.includes("="))) {
          for (const line of lines) addHit({ ...base, ...parseParams(line) });
        } else {
          addHit(base);
        }
        await route.fulfill({ status: 204, body: "" });
        return;
      }
      case "block":
        this.capture.blocked.push({ seq: ++this.seq, method, url, reason: action.reason });
        await route.abort("blockedbyclient");
        return;
    }
  }

  /** Resolves once no new pushes or hits have arrived for `quietMs` (bounded by `maxMs`). Not a fixed sleep. */
  async quiesce(quietMs = 150, maxMs = 3000): Promise<void> {
    const start = Date.now();
    let last = this.capture.pushes.length + this.capture.hits.length + this.capture.blocked.length;
    let lastChange = Date.now();
    while (Date.now() - start < maxMs) {
      await new Promise((r) => setTimeout(r, 25));
      const now = this.capture.pushes.length + this.capture.hits.length + this.capture.blocked.length;
      if (now !== last) { last = now; lastChange = Date.now(); }
      else if (Date.now() - lastChange >= quietMs) return;
    }
  }
}
