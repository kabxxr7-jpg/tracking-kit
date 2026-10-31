import { parseArgs } from "node:util";
import path from "node:path";
import { runAudit, UsageError } from "./audit.js";
import { DEFAULT_CONTAINER_PATH } from "./harness.js";
import { validateGtmFile } from "./gtm-validate.js";
import { DEMO_DIRS, ROOT, startServer } from "./server.js";
import type { ValuePolicy } from "./types.js";

const USAGE = `tracking-kit

  serve [demo|demo-broken] [--port 8790]     serve a demo shop on 127.0.0.1
  audit <demo|demo-broken|URL> [options]     record dataLayer pushes and analytics hits, print a markdown checklist
      --walk                                 walk the demo funnel (local/loopback targets only)
      --container <file>                     container export to emulate (local targets), default gtm/container.json
      --value-policy items|items+tax+shipping   what a purchase value must equal. Default "items" (sum of price x quantity,
                                             tax and shipping left out, as Google's reference says). "items+tax+shipping" is NOT Google's
                                             guidance: use it only if your reporting deliberately differs
      --pii <text>                           a personal value that must not appear anywhere (repeatable)
  validate-gtm [file] [--allow-real-ids]     structural check of a GTM container export

Exit codes: 0 all checks passed, 1 a check failed, 2 bad usage, 3 unexpected error.
External URLs get ONE GET-only page load: no clicks, no form input, non-GET requests blocked, analytics hits never sent.
(GET requests made by a page can still have side effects on the site, for example a tracking pixel or a stateful URL.)
Only point it at sites you own or are allowed to test.`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "--help") { console.log(USAGE); return cmd ? 0 : 2; }

  if (cmd === "serve") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { port: { type: "string" } } });
    const which = (positionals[0] ?? "demo") as keyof typeof DEMO_DIRS;
    if (!(which in DEMO_DIRS)) throw new UsageError(`unknown demo "${which}"`);
    const server = await startServer(DEMO_DIRS[which], values.port ? Number(values.port) : 8790);
    console.log(`${which} is served at ${server.url}/ (Ctrl+C to stop)`);
    await new Promise(() => {});
    return 0;
  }

  if (cmd === "audit") {
    const { values, positionals } = parseArgs({
      args: rest,
      allowPositionals: true,
      options: { walk: { type: "boolean" }, container: { type: "string" }, "value-policy": { type: "string" }, pii: { type: "string", multiple: true } }
    });
    const target = positionals[0];
    if (!target) throw new UsageError("audit needs a target: demo, demo-broken or a URL");
    const vp = values["value-policy"];
    if (vp !== undefined && vp !== "items" && vp !== "items+tax+shipping") throw new UsageError("--value-policy must be items or items+tax+shipping");
    const outcome = await runAudit({
      target,
      ...(values.walk ? { walk: true } : {}),
      ...(values.container ? { containerFile: path.resolve(values.container) } : {}),
      ...(vp ? { valuePolicy: vp as ValuePolicy } : {}),
      ...(values.pii ? { piiValues: values.pii } : {})
    });
    process.stdout.write(outcome.markdown);
    return outcome.ok ? 0 : 1;
  }

  if (cmd === "validate-gtm") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { "allow-real-ids": { type: "boolean" } } });
    const file = path.resolve(positionals[0] ?? DEFAULT_CONTAINER_PATH);
    const r = validateGtmFile(file, { allowRealIds: !!values["allow-real-ids"] });
    console.log(`${path.relative(ROOT, file) || file}: ${r.counts.tags} tags, ${r.counts.triggers} triggers, ${r.counts.variables} variables`);
    for (const e of r.errors) console.log(`ERROR   ${e}`);
    for (const w of r.warnings) console.log(`WARNING ${w}`);
    console.log(r.ok ? "OK: structure matches the shapes this validator knows (not tested in a real GTM workspace)." : `FAILED: ${r.errors.length} error(s).`);
    return r.ok ? 0 : 1;
  }

  throw new UsageError(`unknown command "${cmd}"`);
}

main(process.argv.slice(2)).then(
  (code) => { process.exitCode = code; },
  (e: unknown) => {
    if (e instanceof UsageError || (e instanceof Error && e.name === "TypeError" && /ERR_PARSE_ARGS/.test((e as { code?: string }).code ?? ""))) {
      console.error(`error: ${(e as Error).message}\n\n${USAGE}`);
      process.exitCode = 2;
    } else {
      console.error(e instanceof Error ? e.stack ?? e.message : String(e));
      process.exitCode = 3;
    }
  }
);
