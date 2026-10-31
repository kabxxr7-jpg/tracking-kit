// Mutation check: break the demo, the validator, the emulator, the request policy and the container export on purpose,
// run the test suite against each broken copy, and report how many breakages the tests notice.
// Mutants run in copies under .mutation-work/ (git-ignored), never in the real tree.
//
//   node scripts/mutation-check.mjs [--jobs 2] [--only <id,id>] [--keep]
//
// Exit code: 0 when every mutant was killed, 1 when at least one survived or a run was inconclusive.
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORK = path.join(ROOT, ".mutation-work");
const COPY = ["src", "tests", "demo", "demo-broken", "gtm", "package.json", "tsconfig.json", "vitest.config.ts"];

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
const JOBS = Number(opt("--jobs", "2"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean) ?? [];
const KEEP = args.includes("--keep");

/** `find` must occur exactly once in the file, or the script stops (a stale mutant would count as a fake kill or survivor). */
const swap = (id, desc, file, find, replace) => ({ id, desc, file, apply: (text) => {
  const n = text.split(find).length - 1;
  if (n !== 1) throw new Error(`mutant ${id}: expected exactly 1 match for ${JSON.stringify(find)} in ${file}, found ${n}`);
  return text.replace(find, () => replace);
} });

const MUTANTS = [
  swap("M01-drop-purchase-guard", "thank-you page no longer checks the sent-transactions list", "demo/js/thank-you.js",
    "if (sent.indexOf(order.transaction_id) !== -1) return;", ""),
  swap("M02-no-ecommerce-clear", "push() no longer sends { ecommerce: null } first", "demo/js/track.js",
    'window.dataLayer.push({ ecommerce: null });', ""),
  swap("M03-value-as-string", "purchase value becomes \"$88.09\"", "demo/js/thank-you.js",
    "value: order.value_cents / 100,", 'value: "$" + (order.value_cents / 100).toFixed(2),'),
  swap("M04-drop-item-id", "items lose item_id", "demo/js/track.js",
    "item_id: product.id,", ""),
  swap("M05-default-granted", "consent default grants analytics_storage", "demo/js/consent.js",
    'analytics_storage: "denied",\n    ad_user_data: "denied",\n    ad_personalization: "denied"\n  });', 'analytics_storage: "granted",\n    ad_user_data: "denied",\n    ad_personalization: "denied"\n  });'),
  swap("M06-tags-before-consent", "tag manager is loaded on every page load, before any choice", "demo/js/consent.js",
    "var stored = readChoice();\n  if (stored) apply(stored);", "loadTagManager();\n  var stored = readChoice();\n  if (stored) apply(stored);"),
  swap("M07-value-excludes-shipping", "purchase value leaves out shipping", "demo/js/thank-you.js",
    "value: order.value_cents / 100,", "value: (order.value_cents - order.shipping_cents) / 100,"),
  swap("M08-email-in-event", "add_shipping_info carries the shopper's email", "demo/js/checkout.js",
    "shipping_tier: NW.shipping[shippingKey].label,", "shipping_tier: NW.shipping[shippingKey].label,\n      customer_email: contact.email,"),
  swap("M09-skip-shipping-event", "add_shipping_info is never pushed", "demo/js/checkout.js",
    'NW.track.push("add_shipping_info", {', 'void ({'),
  swap("M10-wrong-removed-quantity", "remove_from_cart reports quantity 1 for a line of 2", "demo/js/cart.js",
    "items: [NW.track.item(line.product, line.qty)]", "items: [NW.track.item(line.product, 1)]"),
  swap("M11-validator-pii-blind", "validator can no longer recognise an email address", "src/validator.ts",
    "const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}/;", "const EMAIL_RE = /^\\b$/;"),
  swap("M12-validator-duplicate-purchase-blind", "validator tolerates two purchases for one transaction", "src/validator.ts",
    "filter(([, n]) => n > 1)", "filter(([, n]) => n > 99)"),
  swap("M13-validator-clear-check-always-true", "validator treats any previous ecommerce push as a reset", "src/validator.ts",
    'prev.data.ecommerce === null && Object.keys(prev.data).length === 1', 'prev.data.ecommerce !== undefined'),
  swap("M14-emulator-ignores-consent", "emulated tags fire even when analytics_storage is denied", "src/emulator/gtm-emulator.js",
    'if (!granted("analytics_storage")) return false;', ""),
  swap("M15-policy-allows-writes", "external mode lets POST requests through", "src/policy.ts",
    'if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") return { kind: "block", reason: `${m} blocked (read-only mode)` };', ""),
  { id: "M16-container-loses-purchase-tag", desc: "GTM export has no purchase event tag", file: "gtm/container.json", apply: (text) => {
    const json = JSON.parse(text);
    const before = json.containerVersion.tag.length;
    json.containerVersion.tag = json.containerVersion.tag.filter((t) => t.name !== "GA4 - Event - purchase");
    if (json.containerVersion.tag.length !== before - 1) throw new Error("mutant M16: purchase tag not found");
    return JSON.stringify(json, null, 2);
  } },
  swap("M17-validator-ignores-tax-shipping", "validator's purchase value check leaves out tax and shipping", "src/validator.ts",
    "expected += tax + ship;", "expected += 0 * (tax + ship);")
];

function run(cwd, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(cwd, "node_modules", "vitest", "vitest.mjs"), "run", "--bail", "1", "--reporter=default", ...extra], { cwd, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

function prepare(id) {
  const dir = path.join(WORK, id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const name of COPY) cpSync(path.join(ROOT, name), path.join(dir, name), { recursive: true });
  symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"));
  return dir;
}

function firstFailure(out) {
  const m = /FAIL\s+(.+)/.exec(out) ?? /×\s+(.+)/.exec(out);
  return m ? m[1].trim().replace(/\s+\d+ms$/, "") : "";
}

async function main() {
  if (!existsSync(path.join(ROOT, "node_modules"))) { console.error("run npm ci first"); process.exit(2); }
  const selected = MUTANTS.filter((m) => ONLY.length === 0 || ONLY.includes(m.id));
  mkdirSync(WORK, { recursive: true });

  // Baseline: the unmodified copy must pass, otherwise "killed" would mean nothing.
  console.log("baseline: running the suite on an unmodified copy ...");
  const baseDir = prepare("baseline");
  let base = await run(baseDir);
  if (base.code !== 0) { console.log("baseline failed once; retrying once to rule out a slow machine ..."); base = await run(baseDir); }
  if (base.code !== 0) { console.error(base.out.split("\n").slice(-40).join("\n")); console.error("baseline failed; mutation results would be meaningless."); process.exit(2); }
  console.log("baseline passed.\n");

  const results = [];
  const queue = [...selected];
  async function worker() {
    while (queue.length) {
      const m = queue.shift();
      const dir = prepare(m.id);
      const target = path.join(dir, m.file);
      writeFileSync(target, m.apply(readFileSync(target, "utf8")));
      const started = Date.now();
      let status = "INCONCLUSIVE";
      let by = "";
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = await run(dir);
        status = r.code === 0 ? "SURVIVED" : /(\d+) failed|FAIL /.test(r.out) ? "killed" : "INCONCLUSIVE";
        by = status === "killed" ? firstFailure(r.out) : r.code === 0 ? "" : "run crashed or timed out";
        if (status !== "killed") break;
        // A kill only counts if the failing test file fails again on its own with a real assertion failure,
        // so a slow machine (timeouts, late beacons) cannot inflate the kill rate. One whole retry is allowed.
        const file = /FAIL\s+(tests\/[^\s>]+)/.exec(r.out)?.[1];
        const again = file ? await run(dir, [file]) : { code: 0, out: "" };
        const reproduced = again.code !== 0 && /FAIL /.test(again.out) && !/timed out/i.test(again.out);
        if (reproduced) break;
        status = "NOT-CONFIRMED";
        by = `failed in ${file ?? "?"} on both attempts but the failure did not reproduce by assertion`;
      }
      results.push({ ...m, status, by, seconds: Math.round((Date.now() - started) / 1000) });
      console.log(`${status.padEnd(13)} ${m.id}  (${results.at(-1).seconds}s)`);
      if (!KEEP) rmSync(dir, { recursive: true, force: true });
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
  if (!KEEP) rmSync(WORK, { recursive: true, force: true });

  results.sort((a, b) => a.id.localeCompare(b.id));
  const killed = results.filter((r) => r.status === "killed").length;
  console.log("\n| Mutant | What was broken | Result | First failing test |\n|---|---|---|---|");
  for (const r of results) console.log(`| ${r.id} | ${r.desc} | ${r.status} | ${r.by || "-"} |`);
  const rate = results.length ? Math.round((killed / results.length) * 100) : 0;
  console.log(`\nKill rate: ${killed}/${results.length} (${rate}%)`);
  const bad = results.filter((r) => r.status !== "killed");
  if (bad.length) console.log(`Not killed: ${bad.map((r) => `${r.id} (${r.status})`).join(", ")}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
