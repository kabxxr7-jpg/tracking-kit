# tracking-kit

> **Status:** a proof project (183 tests, run locally on Node v25.2.1 in headless Google Chrome 156). Tested against a local fake collector and local demo pages only. **NOT run against real GA4 or GTM yet**, and **not used for any client.** The source is public at https://github.com/kabxxr7-jpg/tracking-kit; that does not change the above. See Limits below for what was not verified.

A tested starting point for the usual "fix my Google Analytics 4 / Tag Manager tracking" jobs: ecommerce events that are missing or malformed, purchases counted twice, revenue that does not add up, tags that fire before the visitor agreed, personal data in event parameters.

Everything runs offline. There is no real GA4 property and no real GTM container: the demo shop pushes events into `window.dataLayer`, a small stand-in for `gtm.js` reads the container export and sends GA4-style beacons, and the test harness intercepts every request to a Google host so nothing leaves the machine.

| Piece | Where | What it does |
|---|---|---|
| Demo shop "Northwind Pots" (fictional) | `demo/` | Plain HTML/JS: product list, product page, cart, checkout (shipping + payment steps), thank-you page. Pushes the nine GA4 ecommerce events with `ecommerce: null` before each. Consent Mode v2 banner. |
| Broken twin | `demo-broken/` | The same shop with eight classic bugs on purpose (below). Proof that the checks catch real mistakes. |
| GTM container export | `gtm/container.json` | One GA4 configuration tag, nine GA4 event tags, nine custom-event triggers, dataLayer variables. Placeholder ids only. |
| Validator | `src/validator.ts` | 14 checks over a captured session (dataLayer pushes + analytics hits). |
| Audit CLI | `npm run audit` | Loads a URL in headless Chromium or Google Chrome, records pushes and hits, prints a pass/fail markdown checklist. |
| Container checker | `npm run validate-gtm` | Best-effort structural check of a GTM export. |
| Docs | `docs/` | Tracking plan template and QA checklist (including the real-run steps for the owner). |
| Mutation check | `npm run mutation` | Breaks the code 20 ways and counts how many breakages the tests notice. |

## Quickstart

```bash
npm install
npx playwright-core install chromium     # or have Google Chrome installed; the kit falls back to it
npm test                                 # 183 tests, about 2 minutes (it drives a browser)
npm run typecheck
npm run validate-gtm
npm run audit -- demo                    # starts the shop itself, walks the funnel, prints a markdown report, exit 0
npm run audit -- demo-broken             # same, exit 1, with every failed check named
npm run serve                            # the shop on http://127.0.0.1:8790/ to click through yourself
npm run mutation                         # about 10 to 15 minutes, 20 breakages
npm run mutation:selftest                # 15 seconds: proves a hanging run is cut off with no process left
```

Needs a recent Node (developed and tested on Node v25.2.1 only; other versions are untested). The browser is Playwright's bundled Chromium when installed, otherwise the Google Chrome on the machine (set `TRACKING_KIT_BROWSER=chrome` to prefer Chrome). Local runs for the numbers above used Google Chrome 156.0.8078.76.

### `audit`

```bash
npm run audit -- demo|demo-broken|<url> [--walk] [--container file] [--value-policy items|items+tax+shipping] [--pii <text>]...
```

| Target | What happens |
|---|---|
| `demo`, `demo-broken` | The kit starts the shop on a free local port, accepts the consent banner on the first page, walks the whole funnel, reloads the thank-you page, then checks the capture. |
| A `127.0.0.1` / `localhost` URL | One page load. Add `--walk` to run the same scripted funnel (it only fits this demo's markup). Google Tag Manager is emulated from the container export. |
| Any other URL | **One GET-only page load.** No clicks, no typing, no form submission. Every non-GET request is blocked, requests to loopback or private addresses are blocked, and every analytics hit is recorded and answered locally, never sent. Tag scripts (GET) load normally so the page behaves as it would. GET-only is not the same as harmless: a page's own GET requests (a tracking pixel, a stateful URL, a server-side page-view counter) can still have effects on that site. `--walk` is refused. Only run it on sites you own or are allowed to test. |

Exit codes: 0 all checks passed, 1 a check failed, 2 bad usage, 3 unexpected error. The report is markdown on stdout; redirect it to a file for a ticket or a PR.

## What is covered

### The nine events (dataLayer schema)

`view_item_list`, `view_item`, `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, pushed as `dataLayer.push({ ecommerce: null })` followed by `dataLayer.push({ event, ecommerce: {...} })`. Items carry `item_id`, `item_name`, `price`, `quantity` (plus brand and category). Money is integer cents inside the shop and goes out as numbers.

`purchase` carries `transaction_id`, `value`, `currency`, `tax`, `shipping`, `items[]`.

**`value` policy.** The default follows Google's GA4 events reference for `purchase`: `value` is the sum of price x quantity of the items, and tax and shipping stay out of it (they go in their own `tax` and `shipping` parameters). The reference says "Don't include shipping or tax". I could not open that page from this machine (no network), so the wording comes from the project owner and I have not seen it myself. The demo shop, the validator and the audit all use this rule by default, and every earlier funnel step is also items only.

An explicit opt-in, `--value-policy items+tax+shipping` (option `valuePolicy: "items+tax+shipping"` in code), expects a purchase `value` that also includes tax and shipping. **That is not Google's guidance.** Use it only if your reporting deliberately differs from Google's reference, and write the reason in the tracking plan. A site that reports `value` including tax or shipping fails the default check, and the message says so.

### Consent Mode v2 ("basic")

`demo/js/consent.js` declares `denied` for `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` first, before any tag code exists. The tag manager is not requested until the visitor grants something; a stored choice is replayed on every page (default, then update, then tag manager). Banner buttons: Accept all, Analytics only, Reject; a footer link reopens it so consent can be withdrawn. This is the **basic** implementation (no tag, no hit). "Advanced" mode (tags load and send cookieless pings while denied) is not implemented, and the checks treat a hit before consent as a failure.

### The common tracking bugs it checks

| Bug | Check id | How it is detected | Planted in `demo-broken/` |
|---|---|---|---|
| Tags fire before the visitor chose | `no-hits-before-consent` | any analytics hit before an `update` that grants `analytics_storage` | yes |
| No consent default, or not all four types denied, or declared late | `consent-default` | the first global `default` command must deny all four and come before any tag/hit | yes |
| Stale ecommerce data leaks into the next event | `ecommerce-cleared` | each ecommerce push must be directly preceded by `{ ecommerce: null }` | yes |
| Required parameters missing | `required-params` | per-event list (for example `purchase` needs `transaction_id`, `currency`, `value`, `tax`, `shipping`, `items`) | no |
| Items without `item_id` / `item_name`, price as text, bad quantity | `items-valid` | per-item checks | yes (`item_id`) |
| `value` as `"$70.50"` or `"70.50"` | `numeric-values` | `value`, `tax`, `shipping` must be JS numbers | yes |
| Missing or inconsistent currency | `currency` | 3-letter upper-case ISO code, same on every event | no |
| Revenue that does not add up, or tax/shipping counted in `value` | `value-math` | by default `value` equals the sum of items (price x quantity), exact to the cent, on every event including `purchase`; with the opt-in policy `purchase` must also include tax and shipping | no |
| Purchase counted twice (reload, back button, revisit) | `purchase-once` | one `purchase` per `transaction_id` across the whole capture | yes |
| Funnel steps out of order or missing | `event-order`, `funnel-complete` | first appearance of each step must follow the funnel order | no |
| Email or other personal data in parameters or in the page URL sent with hits | `no-pii` | email regex and personal field names in pushes and hit parameters, plus values you supply with `--pii` | yes (push field and email in the URL) |
| Events that never reach the collector, or reach it twice | `hits-match-events` | emulated runs only: every event pushed after consent must produce exactly one hit | consequence of the above |
| Value sent as text in the hit, no transaction id in the hit | `hit-params` | emulated runs only: hits need `epn.value`, `cu`, and for purchase `ep.transaction_id` | yes |

The purchase guard in the good shop (`demo/js/thank-you.js`) records the `transaction_id` in `sessionStorage` before pushing and skips a transaction it has already sent.

### GTM container export

`gtm/container.json` follows the shapes GTM exports use (`exportFormatVersion` 2, `containerVersion` with `tag`, `trigger`, `variable`, `builtInVariable`, GA4 configuration tag type `gaawc`, GA4 event tag type `gaawe`, `CUSTOM_EVENT` triggers, dataLayer variables of type `v`, a constant variable for the measurement id, tag-level consent settings). Ids are placeholders: `G-XXXXXXXXXX`, `GTM-XXXXXXX`, account and container `0000000000`. It is generated by `scripts/generate-container.mjs` so the nine tags, triggers and variables stay consistent; the generated file is committed.

`npm run validate-gtm [file] [--allow-real-ids]` checks ids and names are unique and present, every tag has existing triggers, every `{{variable}}` exists, parameter types are known, every event tag references the configuration tag, all nine events are wired to a custom-event trigger, and the ids are still placeholders (use `--allow-real-ids` after the owner replaces them).

**Import into a real GTM workspace has not been tested.** The export shapes were written from knowledge of the format, not from a file produced by GTM. If GTM rejects the file, `docs/qa-checklist.md` says what to do.

## What the 183 tests show

| File | Tests | Covers |
|---|---|---|
| `funnel.test.ts` | 28 | The good shop, walked once from the list page to the thank-you page. Exact event order (13 pushes for the fixed basket), all nine events with their documented parameters, `{ ecommerce: null }` before every push, item fields, purchase figures (`value` 70.50 = items only, `tax` 5.64 and `shipping` 11.95 in their own parameters, so the shopper pays 88.09; recomputed in the test, not taken from the validator), `remove_from_cart` reports exactly the removed line, one hit per event in the same order, the purchase hit's `ep.transaction_id` / `epn.value` / `epn.tax` / `epn.shipping` / `cu` / `pr1`, no email, name or address anywhere in pushes or hit URLs, only 127.0.0.1 and the two intercepted Google hostnames were requested, the validator passes all checks on the run |
| `consent.test.ts` | 10 | Before any choice: default denied for all four types, banner shown, no tag script, no hit; events still reach the dataLayer; a whole funnel walk without answering the banner sends zero hits; Accept all, Analytics only (`gcs=G101`), Reject (tag manager never requested, shop still works); a stored choice is replayed (default, update, tag manager); withdrawing consent stops hits; events pushed before the answer are not sent later; the validator agrees |
| `purchase-guard.test.ts` | 8 | Baseline one purchase; reload; five reloads; back then forward; the same thank-you URL again; a genuine second order is still reported; no order in the tab reports nothing; the documented limit (clearing `sessionStorage` lets it fire again) |
| `validator.test.ts` | 61 | Every check pushed over its edge with synthetic captures: consent default (missing, partial, late), hits before consent (including ad-only grant and withdrawal), `ecommerce: null`, required parameters per event, items, string values, currency, value maths exact to the cent (default items-only policy, explicit `items`, and the opt-in `items+tax+shipping` policy, one set of tests per policy, including the hint that names tax/shipping when they were wrongly included), duplicate purchase, funnel order, email masking in findings, hit-level checks |
| `broken.test.ts` | 16 | Raw facts about `demo-broken/` (hits on first load, two purchases, `"$70.50"`, no `item_id`, no reset, email in push and URL) and that each bug is reported by the right check with a useful message, while the checks that are not broken still pass |
| `container-emulation.test.ts` | 5 | The container export decides what is sent: no purchase tag means no purchase hit, a wrong variable path loses the transaction id, a tag needing `ad_storage` stays silent for an analytics-only visitor, the built-in analytics consent check, and all nine events + the placeholder ids appear in hits |
| `gtm-validate.test.ts` | 29 | The committed export passes; counts; a tag and a trigger for each of the nine events; only placeholder ids; 17 tests that break an export on purpose (bad version, real-looking ids, missing tag, unknown trigger, duplicates, unknown variable, bad parameter type, missing fingerprint, ...) each rejected; warnings for missing consent settings and unused triggers |
| `policy.test.ts` | 14 | The request policy as a pure function: local mode serves/records/blocks, external mode blocks writes and private addresses and never forwards analytics hits |
| `audit.test.ts` | 12 | `runAudit` on both demos (counts, markdown, exact list of failed checks for the broken shop), the value-policy option (the opt-in policy fails the demo, the default says "Google's reference") and `--pii`, refusal of non-http and `--walk` on external hosts, a GET-only audit of a page that tries to POST, reach loopback, send a beacon and wait for a click (the server saw only the one GET; nothing was clicked), and the command line exit codes 0, 1 and 2 |

"Killed" in the mutation section below means a test failed; the test files do not call a real Google service.

## Mutation check

`npm run mutation` copies the project into `.mutation-work/` (git-ignored), applies one deliberate breakage per copy, runs the suite with `--bail 1`, and reports whether a test failed. It first runs the suite on an unmodified copy and stops if that fails.

Safeguards, added after an earlier version of the script hung for about 50 minutes on one mutant (M13) and left stray node processes:

- **Per-run hard timeout** (default 6 minutes, `--timeout-min`; a normal full run takes about 2). On timeout the script kills the whole process tree (the test runner, its workers, anything they started, and the process group) and reports **TIMEOUT**, which is **not a kill**. A TIMEOUT only becomes a kill if a test file that had already failed fails again on its own, by assertion, within its own time limit.
- **Every kill is confirmed**: the failing file must fail again when run alone, with a real assertion failure (not a timeout), so a slow machine cannot inflate the rate. An unconfirmed result gets one whole retry and is then reported as NOT-CONFIRMED.
- **No orphans**: the script waits for the runner's exit, not for its output pipe to close, and sweeps the process tree after every run. The summary prints how many stray processes were left (0 in the last run). `npm run mutation:selftest` proves the timeout path: it plants a test file that spins forever, and checks that the run is cut off after 15 seconds with no process left behind (it did: `timedOut=true leftoverProcesses=0 elapsed=15s`).

**Why the old script hung.** On a timeout it sent SIGKILL to the runner process only. The runner's worker processes survived, still held the runner's output pipe open, and the script was waiting for that pipe to close, which never happened. I confirmed this mechanism with a small experiment (a killed parent whose child inherits the pipe: `exit` fired, `close` never did). **What I could not establish is what made M13's test run slow enough to hit the 10-minute limit in the first place.** M13 itself is a one-line change in a pure function and completed in 53 seconds in my last full run. I saw two unexplained 60-second test timeouts myself (see Limits) and could not reproduce either in 15 further runs; both are consistent with a machine stall, but I have no evidence for that.

The 20 breakages: drop the purchase guard; stop clearing `ecommerce`; purchase value as a string; items without `item_id`; consent default granted; tag manager loaded before consent; purchase value wrongly includes shipping; an email in an event; skip the `add_shipping_info` push; wrong quantity in `remove_from_cart`; validator blind to email addresses; validator tolerant of duplicate purchases; validator that treats any previous push as an ecommerce reset; emulated tags ignoring consent; external audit allowing POST; container export without the purchase tag; validator ignoring the value-policy option; purchase value wrongly includes tax and shipping (the old rule); validator whose default policy is flipped to `items+tax+shipping`; opt-in policy that leaves out tax and shipping.

**Result of the last run (2026-10-31, after the final code change): 20 of 20 breakages killed (100%), 0 timeouts, 0 survivors, 0 stray processes.** The baseline copy passed first. Each result was confirmed by re-running the failing file alone.

| Mutant | Broken | Result | First failing test (the run stops at the first failure, so this is one of possibly several that notice it) |
|---|---|---|---|
| M01 | purchase guard removed | killed | `audit.test.ts` demo audit passes all checks |
| M02 | no `{ ecommerce: null }` | killed | same |
| M03 | purchase value as `"$70.50"` | killed | same |
| M04 | items without `item_id` | killed | same |
| M05 | consent default grants `analytics_storage` | killed | same |
| M06 | tag manager loaded before consent | killed | `consent.test.ts` or `audit.test.ts` (the first to fail differed between runs) |
| M07 | purchase value includes shipping | killed | `audit.test.ts` demo audit |
| M08 | email in `add_shipping_info` | killed | `audit.test.ts` |
| M09 | `add_shipping_info` never pushed | killed | `audit.test.ts` |
| M10 | wrong quantity in `remove_from_cart` | killed | `audit.test.ts` |
| M11 | validator blind to emails | killed | `broken.test.ts` / `audit.test.ts` |
| M12 | validator tolerates duplicate purchase | killed | `audit.test.ts` broken-shop audit |
| M13 | validator accepts any previous ecommerce push as a reset | killed (53 s) | `validator.test.ts` "fails when the reset push carries other keys too" |
| M14 | emulated tags ignore consent | killed | `container-emulation.test.ts` built-in consent check |
| M15 | external mode lets POST through | killed | `audit.test.ts` GET-only audit |
| M16 | container without the purchase tag | killed | `audit.test.ts` |
| M17 | validator ignores the value-policy option | killed | `audit.test.ts` value-policy test |
| M18 | purchase value includes tax and shipping (old rule) | killed | `audit.test.ts` demo audit |
| M19 | validator default flipped to `items+tax+shipping` | killed | `audit.test.ts` demo audit |
| M20 | opt-in policy ignores tax and shipping | killed | `audit.test.ts` value-policy test |

What this does not show: the audit test runs early, so it is listed for most rows, but I did not tabulate which other tests would also fail for each breakage. A mutation score only says the tests notice these 20 changes, not that they notice every possible bug. Two earlier lessons: an older run killed 16 of 17 because M14 survived (the container's own consent settings made the emulator's built-in check redundant, so I added a test that strips them); and an older M06 "kill" came from a failure that did not reproduce, which the confirmation step caught.

## Doing the real run (not done yet)

1. Replace `GTM-XXXXXXX` in `demo/js/consent.js` and `G-XXXXXXXXXX` in `gtm/container.json` with ids from a **test** property and container.
2. Follow `docs/qa-checklist.md` part 2: import the container, check Tag Assistant (consent, nine events, no second purchase after reload), GA4 DebugView (parameters, no personal data), then reports 24 to 48 hours later.
3. Record the outcome in the table at the end of that file, and only then change the Status line above.

For a client site the workflow is: `docs/tracking-plan-template.md` first (agree events, parameters, value policy), implement, run `npm run audit -- <url>` for the cheap checks, then the manual real-run checklist.

## Limits (read these before relying on it)

- **Never run against real GA4 or GTM.** Every number above comes from a local fake collector. No claim is made that Google accepts these events, processes them, or reports the revenue as the checks expect.
- **The value-policy default follows Google's reference, as relayed to me.** For `purchase`, the reference tells you not to include shipping or tax in `value` ("Don't include shipping or tax"); the kit's default now matches that. I could not read the page (no network), so I am relying on that wording. The checks themselves were written by the author of this kit and have **not** been compared with Google's own debug tools (DebugView, Tag Assistant, the Measurement Protocol validation server); they encode my reading of the documentation, and a check that passes here can still be wrong in GA4. The opt-in `items+tax+shipping` policy exists only for sites whose reporting deliberately differs from Google's guidance.
- **`gtm.js` is emulated, not run.** `src/emulator/gtm-emulator.js` supports only GA4 configuration and event tags, built-in All Pages and `CUSTOM_EVENT`/`EQUALS` triggers, and `v`/`c` variables. The query-string format of the beacons (`en`, `ep.*`, `epn.*`, `pr1=`, `cu`, `gcs`) approximates the GA4 wire format from memory and has not been compared with a real hit. Real GTM may order consent handling and queued events differently: the emulator does not send events pushed before the visitor answered, which I have not confirmed matches GTM.
- **The container import is untested** and uses the classic `gaawc` (GA4 Configuration) tag type; newer containers use the Google tag.
- **Basic Consent Mode only.** No advanced mode, no regional defaults, no `wait_for_update`, no CMP integration, no server-side tagging, no Enhanced Conversions, no Google Ads tags.
- **The purchase guard is per tab session.** A new tab, a different browser, a cleared `sessionStorage`, or a deep link without the order in storage can report the same order again (one test documents this). A production fix usually needs a server-side marker on the order, or `transaction_id` de-duplication at the reporting layer; I did not verify how GA4 itself de-duplicates.
- **PII detection is pattern-based.** It finds email addresses, a short list of personal field names, and any values you pass with `--pii`. It does not find names, addresses, phone numbers or ids that are really personal data without help.
- **External audits see one page load, before any consent choice.** They cannot judge the funnel, the post-consent behaviour or purchase de-duplication. A site on advanced Consent Mode will fail the consent checks by design. The load is GET-only, not side-effect free (see above). Robots rules are not read; use it only on sites you own or are allowed to test. Behaviour against real third-party sites was never exercised (only against a local page standing in for one).
- **The funnel walk fits only this demo's markup.** Pointing `--walk` at another local app needs new selectors in `src/funnel.ts`.
- **One browser, one machine.** Headless Google Chrome 156 on macOS (Playwright's bundled Chromium was not installed on the test machine, so the Chrome fallback was what ran; the bundled Chromium path is untested) with Node v25.2.1; a CI workflow exists (`.github/workflows/ci.yml`: install Playwright's Chromium on Linux, typecheck, validate, test), but I have not seen it run, so it is unverified. Quiet-period waits (`Harness.quiesce`) are bounded debounces, not fixed sleeps, but a very slow machine could still see late beacons.
- **Unexplained slow runs.** Twice a test hit its 60 second timeout for no reason I found: once in the first consent test during a mutation baseline, and once in the first two tests of `audit.test.ts` during a three-file run. Neither reproduced in later runs (3 runs of that file alone, 4 repeats of the three-file run, 8 repeats of the audit walk in a loop, and four runs in parallel). The request handler now aborts a request instead of hanging if it throws, which is one possible cause, but I cannot say that was it. If you see a 60 second timeout, re-run before trusting a failure.
- **Not production code.** No logging framework, no scheduling, no monitoring. Fictional shop and made-up data only.

## Layout

```
demo/            the shop (index, product, cart, checkout, thank-you) + js/ (consent, store, track, one script per page)
demo-broken/     same shop with planted bugs (each marked BUG in its js/)
gtm/             container.json (generated, committed)
src/             validator, gtm-validate, audit, cli, harness (recorder + request routing), policy, emulator/, funnel, server, browser
tests/           vitest suites + helpers + fixtures/external-like
scripts/         generate-container.mjs, mutation-check.mjs
docs/            tracking-plan-template.md, qa-checklist.md
.github/         ci.yml (npm ci, install chromium, typecheck, validate, test)
```
