# tracking-kit

> **Status:** a proof project (179 tests, run locally on Node v25.2.1 in headless Google Chrome 156 (fallback; Playwright's bundled Chromium is not installed on this machine)). Tested against a local fake collector and local demo pages only. **NOT run against real GA4 or GTM yet**, and **not used for any client.** See Limits below for what was not verified.

A tested starting point for the usual "fix my Google Analytics 4 / Tag Manager tracking" jobs: ecommerce events that are missing or malformed, purchases counted twice, revenue that does not add up, tags that fire before the visitor agreed, personal data in event parameters.

Everything runs offline. There is no real GA4 property and no real GTM container: the demo shop pushes events into `window.dataLayer`, a small stand-in for `gtm.js` reads the container export and sends GA4-style beacons, and the test harness intercepts every request to a Google host so nothing leaves the machine.

| Piece | Where | What it does |
|---|---|---|
| Demo shop "Northwind Pots" (fictional) | `demo/` | Plain HTML/JS: product list, product page, cart, checkout (shipping + payment steps), thank-you page. Pushes the nine GA4 ecommerce events with `ecommerce: null` before each. Consent Mode v2 banner. |
| Broken twin | `demo-broken/` | The same shop with eight classic bugs on purpose (below). Proof that the checks catch real mistakes. |
| GTM container export | `gtm/container.json` | One GA4 configuration tag, nine GA4 event tags, nine custom-event triggers, dataLayer variables. Placeholder ids only. |
| Validator | `src/validator.ts` | 14 checks over a captured session (dataLayer pushes + analytics hits). |
| Audit CLI | `npm run audit` | Loads a URL in headless Chromium, records pushes and hits, prints a pass/fail markdown checklist. |
| Container checker | `npm run validate-gtm` | Best-effort structural check of a GTM export. |
| Docs | `docs/` | Tracking plan template and QA checklist (including the real-run steps for the owner). |
| Mutation check | `npm run mutation` | Breaks the code 17 ways and counts how many breakages the tests notice. |

## Quickstart

```bash
npm install
npx playwright-core install chromium     # or have Google Chrome installed; the kit falls back to it
npm test                                 # 179 tests, about 2 minutes (it drives a browser)
npm run typecheck
npm run validate-gtm
npm run audit -- demo                    # starts the shop itself, walks the funnel, prints a markdown report, exit 0
npm run audit -- demo-broken             # same, exit 1, with every failed check named
npm run serve                            # the shop on http://127.0.0.1:8790/ to click through yourself
npm run mutation                         # about @@MUTMIN@@ minutes
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
| Any other URL | **One read-only page load.** No clicks, no typing, no form submission. Every non-GET request is blocked, requests to loopback or private addresses are blocked, and every analytics hit is recorded and answered locally, never sent. Tag scripts (GET) load normally so the page behaves as it would. `--walk` is refused. Only run it on sites you own or are allowed to test. |

Exit codes: 0 all checks passed, 1 a check failed, 2 bad usage, 3 unexpected error. The report is markdown on stdout; redirect it to a file for a ticket or a PR.

## What is covered

### The nine events (dataLayer schema)

`view_item_list`, `view_item`, `add_to_cart`, `remove_from_cart`, `view_cart`, `begin_checkout`, `add_shipping_info`, `add_payment_info`, `purchase`, pushed as `dataLayer.push({ ecommerce: null })` followed by `dataLayer.push({ event, ecommerce: {...} })`. Items carry `item_id`, `item_name`, `price`, `quantity` (plus brand and category). Money is integer cents inside the shop and goes out as numbers.

`purchase` carries `transaction_id`, `value`, `currency`, `tax`, `shipping`, `items[]`. **`value` policy:** the kit defaults to *items + tax + shipping* for `purchase` (and items only for every earlier step). Whether tax and shipping belong in `value` is a reporting decision that should be written into the tracking plan; `--value-policy items` switches the check. I did not check which one Google currently recommends, so treat the default as a choice, not a fact.

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
| `value` as `"$88.09"` or `"88.09"` | `numeric-values` | `value`, `tax`, `shipping` must be JS numbers | yes |
| Missing or inconsistent currency | `currency` | 3-letter upper-case ISO code, same on every event | no |
| Revenue that does not add up | `value-math` | `value` equals items (price x quantity), plus tax and shipping on `purchase`, exact to the cent | no |
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

## What the 179 tests show

| File | Tests | Covers |
|---|---|---|
| `funnel.test.ts` | 28 | The good shop, walked once from the list page to the thank-you page. Exact event order (13 pushes for the fixed basket), all nine events with their documented parameters, `{ ecommerce: null }` before every push, item fields, purchase figures (88.09 = 70.50 items + 5.64 tax + 11.95 shipping, recomputed in the test, not taken from the validator), `remove_from_cart` reports exactly the removed line, one hit per event in the same order, the purchase hit's `ep.transaction_id` / `epn.value` / `epn.tax` / `epn.shipping` / `cu` / `pr1`, no email, name or address anywhere in pushes or hit URLs, only 127.0.0.1 and the two intercepted Google hostnames were requested, the validator passes all checks on the run |
| `consent.test.ts` | 10 | Before any choice: default denied for all four types, banner shown, no tag script, no hit; events still reach the dataLayer; a whole funnel walk without answering the banner sends zero hits; Accept all, Analytics only (`gcs=G101`), Reject (tag manager never requested, shop still works); a stored choice is replayed (default, update, tag manager); withdrawing consent stops hits; events pushed before the answer are not sent later; the validator agrees |
| `purchase-guard.test.ts` | 8 | Baseline one purchase; reload; five reloads; back then forward; the same thank-you URL again; a genuine second order is still reported; no order in the tab reports nothing; the documented limit (clearing `sessionStorage` lets it fire again) |
| `validator.test.ts` | 58 | Every check pushed over its edge with synthetic captures: consent default (missing, partial, late), hits before consent (including ad-only grant and withdrawal), `ecommerce: null`, required parameters per event, items, string values, currency, value maths exact to the cent under both policies, duplicate purchase, funnel order, email masking in findings, hit-level checks |
| `broken.test.ts` | 16 | Raw facts about `demo-broken/` (hits on first load, two purchases, `"$88.09"`, no `item_id`, no reset, email in push and URL) and that each bug is reported by the right check with a useful message, while the checks that are not broken still pass |
| `container-emulation.test.ts` | 5 | The container export decides what is sent: no purchase tag means no purchase hit, a wrong variable path loses the transaction id, a tag needing `ad_storage` stays silent for an analytics-only visitor, the built-in analytics consent check, and all nine events + the placeholder ids appear in hits |
| `gtm-validate.test.ts` | 29 | The committed export passes; counts; a tag and a trigger for each of the nine events; only placeholder ids; 17 ways of breaking an export (bad version, real-looking ids, missing tag, unknown trigger, duplicates, unknown variable, bad parameter type, missing fingerprint, ...) each rejected; warnings for missing consent settings and unused triggers |
| `policy.test.ts` | 14 | The request policy as a pure function: local mode serves/records/blocks, external mode blocks writes and private addresses and never forwards analytics hits |
| `audit.test.ts` | 11 | `runAudit` on both demos (counts, markdown, exact list of failed checks for the broken shop), the value-policy and `--pii` options, refusal of non-http and `--walk` on external hosts, a read-only audit of a page that tries to POST, reach loopback, send a beacon and wait for a click (the server saw only the one GET; nothing was clicked), and the command line exit codes 0, 1 and 2 |

"Killed" in the mutation section below means a test failed; the test files do not call a real Google service.

## Mutation check

`npm run mutation` copies the project into `.mutation-work/` (git-ignored), applies one deliberate breakage per copy, runs the suite with `--bail 1`, and reports whether a test failed. A kill only counts when the failing file fails again on its own with a real assertion failure (not a timeout), so a slow machine cannot inflate the rate. It first runs the suite on an unmodified copy and stops if that fails.

The 17 breakages: drop the purchase guard; stop clearing `ecommerce`; purchase value as a string; items without `item_id`; consent default granted; tag manager loaded before consent; value without shipping; an email in an event; skip the `add_shipping_info` push; wrong quantity in `remove_from_cart`; validator blind to email addresses; validator tolerant of duplicate purchases; validator that treats any previous push as an ecommerce reset; emulated tags ignoring consent; external audit allowing POST; container export without the purchase tag; validator ignoring tax and shipping.

@@MUTRESULT@@

## Doing the real run (not done yet)

1. Replace `GTM-XXXXXXX` in `demo/js/consent.js` and `G-XXXXXXXXXX` in `gtm/container.json` with ids from a **test** property and container.
2. Follow `docs/qa-checklist.md` part 2: import the container, check Tag Assistant (consent, nine events, no second purchase after reload), GA4 DebugView (parameters, no personal data), then reports 24 to 48 hours later.
3. Record the outcome in the table at the end of that file, and only then change the Status line above.

For a client site the workflow is: `docs/tracking-plan-template.md` first (agree events, parameters, value policy), implement, run `npm run audit -- <url>` for the cheap checks, then the manual real-run checklist.

## Limits (read these before relying on it)

- **Never run against real GA4 or GTM.** Every number above comes from a local fake collector. No claim is made that Google accepts these events, processes them, or reports the revenue as the checks expect.
- **`gtm.js` is emulated, not run.** `src/emulator/gtm-emulator.js` supports only GA4 configuration and event tags, built-in All Pages and `CUSTOM_EVENT`/`EQUALS` triggers, and `v`/`c` variables. The query-string format of the beacons (`en`, `ep.*`, `epn.*`, `pr1=`, `cu`, `gcs`) approximates the GA4 wire format from memory and has not been compared with a real hit. Real GTM may order consent handling and queued events differently: the emulator does not send events pushed before the visitor answered, which I have not confirmed matches GTM.
- **The container import is untested** and uses the classic `gaawc` (GA4 Configuration) tag type; newer containers use the Google tag.
- **Basic Consent Mode only.** No advanced mode, no regional defaults, no `wait_for_update`, no CMP integration, no server-side tagging, no Enhanced Conversions, no Google Ads tags.
- **The purchase guard is per tab session.** A new tab, a different browser, a cleared `sessionStorage`, or a deep link without the order in storage can report the same order again (one test documents this). A production fix usually needs a server-side marker on the order, or `transaction_id` de-duplication at the reporting layer; I did not verify how GA4 itself de-duplicates.
- **PII detection is pattern-based.** It finds email addresses, a short list of personal field names, and any values you pass with `--pii`. It does not find names, addresses, phone numbers or ids that are really personal data without help.
- **External audits see one page load, before any consent choice.** They cannot judge the funnel, the post-consent behaviour or purchase de-duplication. A site on advanced Consent Mode will fail the consent checks by design. Robots rules are not read; use it only on sites you own or are allowed to test. Behaviour against real third-party sites was never exercised (only against a local page standing in for one).
- **The funnel walk fits only this demo's markup.** Pointing `--walk` at another local app needs new selectors in `src/funnel.ts`.
- **One browser, one machine.** Headless Google Chrome 156 (fallback; Playwright's bundled Chromium is not installed on this machine) on macOS with Node v25.2.1; the CI file installs Playwright's Chromium on Linux but has not run yet (the repo is not on GitHub). Quiet-period waits (`Harness.quiesce`) are bounded debounces, not fixed sleeps, but a very slow machine could still see late beacons.
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
