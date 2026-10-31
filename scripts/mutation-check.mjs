// Mutation check: break the demo, the validator, the emulator, the request policy and the container export on purpose,
// run the test suite against each broken copy, and report how many breakages the tests notice.
// Mutants run in copies under .mutation-work/ (git-ignored), never in the real tree.
//
//   node scripts/mutation-check.mjs [--jobs 2] [--only <id,id>] [--keep] [--timeout-min 6]
//   node scripts/mutation-check.mjs --selftest        (proves the timeout kills a hanging run and leaves no process behind)
//
// Every test run has a hard timeout (default 6 minutes; a normal full run takes about 2). On timeout the whole process
// tree is killed (the vitest process, its workers, anything they started, and the process group), and the mutant is
// reported as TIMEOUT, which is NOT a kill, unless a test file that had already failed fails again on its own.
//
// Exit code: 0 when every mutant was killed, 1 when at least one survived, timed out or was inconclusive.
import { execFileSync, spawn } from "node:child_process";
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
const SELFTEST = args.includes("--selftest");
const RUN_TIMEOUT_MS = Number(opt("--timeout-min", "6")) * 60_000;
const CONFIRM_TIMEOUT_MS = Math.min(RUN_TIMEOUT_MS, 3 * 60_000);

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
  swap("M03-value-as-string", "purchase value becomes \"$70.50\"", "demo/js/thank-you.js",
    "value: order.subtotal_cents / 100,", 'value: "$" + (order.subtotal_cents / 100).toFixed(2),'),
  swap("M04-drop-item-id", "items lose item_id", "demo/js/track.js",
    "item_id: product.id,", ""),
  swap("M05-default-granted", "consent default grants analytics_storage", "demo/js/consent.js",
    'analytics_storage: "denied",\n    ad_user_data: "denied",\n    ad_personalization: "denied"\n  });', 'analytics_storage: "granted",\n    ad_user_data: "denied",\n    ad_personalization: "denied"\n  });'),
  swap("M06-tags-before-consent", "tag manager is loaded on every page load, before any choice", "demo/js/consent.js",
    "var stored = readChoice();\n  if (stored) apply(stored);", "loadTagManager();\n  var stored = readChoice();\n  if (stored) apply(stored);"),
  swap("M07-value-includes-shipping", "purchase value wrongly includes shipping (Google: leave it out)", "demo/js/thank-you.js",
    "value: order.subtotal_cents / 100,", "value: (order.subtotal_cents + order.shipping_cents) / 100,"),
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
    'if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") return { kind: "block", reason: `${m} blocked (GET-only mode)` };', ""),
  { id: "M16-container-loses-purchase-tag", desc: "GTM export has no purchase event tag", file: "gtm/container.json", apply: (text) => {
    const json = JSON.parse(text);
    const before = json.containerVersion.tag.length;
    json.containerVersion.tag = json.containerVersion.tag.filter((t) => t.name !== "GA4 - Event - purchase");
    if (json.containerVersion.tag.length !== before - 1) throw new Error("mutant M16: purchase tag not found");
    return JSON.stringify(json, null, 2);
  } },
  swap("M17-validator-ignores-policy-option", "validator ignores the value-policy option (always uses items)", "src/validator.ts",
    'const policy: ValuePolicy = options.valuePolicy ?? "items";', 'const policy: ValuePolicy = "items";'),
  swap("M18-value-includes-tax-and-shipping", "purchase value wrongly includes tax and shipping (the old rule)", "demo/js/thank-you.js",
    "value: order.subtotal_cents / 100,", "value: order.value_cents / 100,"),
  swap("M19-validator-default-flipped", "validator's default policy becomes items+tax+shipping", "src/validator.ts",
    'const policy: ValuePolicy = options.valuePolicy ?? "items";', 'const policy: ValuePolicy = options.valuePolicy ?? "items+tax+shipping";'),
  swap("M20-optin-policy-ignores-tax-shipping", "opt-in items+tax+shipping policy leaves out tax and shipping", "src/validator.ts",
    "expected += tax + ship;", "expected += 0 * (tax + ship);")
];

/** pid -> ppid for every process, from `ps`. */
function processTable() {
  const rows = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).split("\n");
  const table = new Map();
  for (const row of rows) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(row);
    if (m) table.set(Number(m[1]), Number(m[2]));
  }
  return table;
}
function descendantsOf(root, table = processTable()) {
  const out = [];
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift();
    for (const [pid, ppid] of table) if (ppid === parent && !out.includes(pid)) { out.push(pid); queue.push(pid); }
  }
  return out;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const active = new Set();
/** Kills the process, its whole descendant tree and its process group. Returns how many of them were still alive afterwards. */
async function killTree(pid) {
  const victims = [pid, ...descendantsOf(pid)];
  try { process.kill(-pid, "SIGKILL"); } catch { /* group already gone */ }
  for (const v of victims.reverse()) { try { process.kill(v, "SIGKILL"); } catch { /* already gone */ } }
  await new Promise((r) => setTimeout(r, 500));
  return victims.filter(alive).length;
}
function killAllActive() {
  for (const pid of active) {
    try { process.kill(-pid, "SIGKILL"); } catch { /* ignore */ }
    for (const d of descendantsOf(pid)) { try { process.kill(d, "SIGKILL"); } catch { /* ignore */ } }
  }
}
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { killAllActive(); process.exit(130); });
process.on("exit", killAllActive);

function run(cwd, extra = [], timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(cwd, "node_modules", "vitest", "vitest.mjs"), "run", "--bail", "1", "--reporter=default", ...extra], {
      cwd,
      detached: true, // own process group, so the whole tree can be killed at once
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" }
    });
    active.add(child.pid);
    let out = "";
    let timedOut = false;
    let leftover = 0;
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    // Resolve on "exit", not "close": a grandchild that keeps the output pipe open must not be able to block us.
    const done = async (code) => {
      clearTimeout(timer);
      if (!timedOut) leftover = await killTree(child.pid); // sweep workers that outlived a --bail shutdown
      active.delete(child.pid);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ code: timedOut ? null : code, out, timedOut, leftover });
    };
    const timer = setTimeout(async () => {
      timedOut = true;
      leftover = await killTree(child.pid);
    }, timeoutMs);
    child.on("exit", (code) => { void done(code); });
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

const failedTestFile = (out) => /FAIL\s+(tests\/[^\s>]+)/.exec(out)?.[1];

/** Runs the suite on a mutated copy and decides: killed, SURVIVED, TIMEOUT, NOT-CONFIRMED or INCONCLUSIVE. */
async function evaluate(dir) {
  let leftover = 0;
  let last = { status: "INCONCLUSIVE", by: "" };
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = await run(dir);
    leftover += r.leftover;
    if (r.code === 0 && !r.timedOut) return { status: "SURVIVED", by: "", leftover };
    const file = failedTestFile(r.out);
    if (!file) {
      last = r.timedOut
        ? { status: "TIMEOUT", by: `no test had failed when the run was killed after ${Math.round(RUN_TIMEOUT_MS / 60000)} min (not a kill)` }
        : { status: "INCONCLUSIVE", by: "the run failed without a failing test (crash?)" };
      continue;
    }
    // A kill only counts if the failing file fails again on its own, by assertion, within its own time limit.
    // This also applies when the first run was cut off by the timeout after a test had already failed.
    const again = await run(dir, [file], CONFIRM_TIMEOUT_MS);
    leftover += again.leftover;
    const reproduced = !again.timedOut && again.code !== 0 && /FAIL /.test(again.out) && !/timed out/i.test(again.out);
    if (reproduced) return { status: "killed", by: firstFailure(r.out), leftover };
    last = r.timedOut || again.timedOut
      ? { status: "TIMEOUT", by: `run was cut off by the timeout and ${file} did not fail again on its own (not a kill)` }
      : { status: "NOT-CONFIRMED", by: `failed in ${file} but the failure did not reproduce by assertion` };
  }
  return { ...last, leftover };
}

async function selftest() {
  // A test file that spins forever in a synchronous loop: vitest cannot time it out, so only the script's own timeout can end it.
  const dir = prepare("selftest-hang");
  const target = path.join(dir, "tests/policy.test.ts");
  writeFileSync(target, "while (true) {}\n" + readFileSync(target, "utf8"));
  const started = Date.now();
  const r = await run(dir, [], 15_000);
  const seconds = Math.round((Date.now() - started) / 1000);
  rmSync(WORK, { recursive: true, force: true });
  const ok = r.timedOut && r.leftover === 0 && seconds < 40;
  console.log(`selftest: timedOut=${r.timedOut} leftoverProcesses=${r.leftover} elapsed=${seconds}s -> ${ok ? "OK, the hang was cut off and no process was left behind" : "FAILED"}`);
  process.exit(ok ? 0 : 1);
}

async function main() {
  if (!existsSync(path.join(ROOT, "node_modules"))) { console.error("run npm ci first"); process.exit(2); }
  mkdirSync(WORK, { recursive: true });
  if (SELFTEST) return selftest();
  const selected = MUTANTS.filter((m) => ONLY.length === 0 || ONLY.includes(m.id));

  // Baseline: the unmodified copy must pass, otherwise "killed" would mean nothing.
  console.log("baseline: running the suite on an unmodified copy ...");
  const baseDir = prepare("baseline");
  let base = await run(baseDir);
  if (base.code !== 0) { console.log(`baseline ${base.timedOut ? "timed out" : "failed"} once; retrying once to rule out a slow machine ...`); base = await run(baseDir); }
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
      const verdict = await evaluate(dir);
      results.push({ ...m, ...verdict, seconds: Math.round((Date.now() - started) / 1000) });
      console.log(`${verdict.status.padEnd(13)} ${m.id}  (${results.at(-1).seconds}s${verdict.leftover ? `, ${verdict.leftover} stray process(es) after cleanup` : ""})`);
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
  const strays = results.reduce((n, r) => n + (r.leftover ?? 0), 0);
  console.log(`Stray processes left after cleanup: ${strays}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { killAllActive(); console.error(e); process.exit(2); });
