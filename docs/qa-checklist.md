# QA checklist

Two parts: what the kit already proves offline, and what only a real run can prove. Part 2 has **not been done** for this kit; it is the list the owner follows when a real GA4 property and GTM container are available.

## Part 1: offline (done by `npm test` and `npm run audit`)

- [x] dataLayer shape of the nine ecommerce events, `ecommerce: null` before each push
- [x] `value` is a number and adds up (items, plus tax and shipping on purchase)
- [x] `purchase` fires once across reload, back/forward and a repeat visit in the same tab
- [x] No email or personal field in pushes or in the page URL sent with hits
- [x] Consent default denied for the four Consent Mode v2 types before any tag; no hits before consent; hits after
- [x] The container export parses and is internally consistent (best effort)

Not covered offline: whether Google accepts the container import, whether GA4 processes and reports the events, whether the real `gtm.js` behaves like the emulator.

## Part 2: real run (to do)

### 0. Prepare

1. Create a GA4 **test** property (or a data stream you can delete) so nothing pollutes production reports.
2. Create a GTM **web** container and a workspace.
3. In the repo, replace the placeholders:
   - `GTM-XXXXXXX` in `demo/js/consent.js`
   - `G-XXXXXXXXXX` in `gtm/container.json` (the constant variable "Const - GA4 Measurement ID"), and the container id in `container.publicId` if you want the export to match
4. Run `npm run validate-gtm -- gtm/container.json --allow-real-ids` to confirm the edited file still has the right shape.
5. Host the demo anywhere you control over HTTPS (or use `npm run serve` on localhost with the container's preview mode).

### 1. Import the container

1. GTM > Admin > Import Container > choose `gtm/container.json` > pick the workspace > **Merge** (do not overwrite an existing container).
2. If GTM rejects the file, note the message and fix `scripts/generate-container.mjs`; the shapes there are from memory of the export format, not verified.
3. Check the imported workspace: 1 configuration tag, 9 event tags, 9 custom-event triggers, 10 variables.
4. Confirm the tags have **Consent settings: require analytics_storage** (Advanced Settings > Consent Settings).
5. If your GTM version prefers the newer **Google tag** over the "GA4 Configuration" tag type, recreate the configuration tag as a Google tag with the same measurement id and keep the nine event tags.

### 2. Tag Assistant (GTM preview)

1. GTM > **Preview**, enter the demo URL, connect.
2. On the first page, before touching the banner: in Tag Assistant's **Consent** tab the four types are `Denied` on "Consent Initialization", and no GA4 tag has fired.
3. Click **Accept all**. Consent shows `Granted` for all four. The configuration tag fires on the next `gtm.js`/page event.
4. Walk the funnel (open a product, add to cart, view cart, checkout, shipping, payment, place order). For each of the nine events:
   - the event appears in the left timeline with the `ecommerce` object in the Data Layer tab
   - the matching GA4 event tag shows **Tags Fired**
   - the tag's event parameters show the right `transaction_id`, `value`, `currency`, `tax`, `shipping`
5. Reload the thank-you page. The timeline must **not** show a second `purchase`.
6. Repeat with **Reject** (use "Cookie settings" in the footer). No GA4 tag fires; the events still appear in the Data Layer tab.
7. Repeat with **Analytics only**. GA4 tags fire; ad types stay `Denied`.

### 3. GA4 DebugView

1. Admin > DebugView. Open the demo with GTM preview connected (preview mode sets debug mode), or add the Chrome "Google Analytics Debugger" extension.
2. Walk the funnel again. Each of the nine events appears in the stream, in order.
3. Click `purchase`: the parameters list shows `transaction_id`, `value` (number), `currency`, `tax`, `shipping`, and the `items` array with `item_id`, `item_name`, `price`, `quantity`.
4. Reload the thank-you page: no second `purchase` in DebugView.
5. Click any event and look through every parameter and the page location/URL: no email, name or address.

### 4. Reports (allow 24 to 48 hours for standard reports; use Realtime meanwhile)

1. Realtime: events arrive with the expected counts.
2. Admin > Events: the nine events are listed. Mark `purchase` as a key event if it is not already.
3. Monetization > Ecommerce purchases: the test order shows the expected revenue (check against the **value policy** written in the tracking plan).
4. Explore > a free-form report with `transaction_id` as the dimension: each id appears once.
5. Reports > Monetization > Purchase journey: the funnel steps show counts for each step.

### 5. Record the run

Fill in the table and commit it, so the README can say what was actually verified.

| Item | Date | Who | Result | Notes |
|---|---|---|---|---|
| Container imported without errors | | | | |
| Consent denied before choice (Tag Assistant) | | | | |
| 9 events fired (Tag Assistant) | | | | |
| 9 events in DebugView | | | | |
| Purchase once after reload | | | | |
| No personal data seen | | | | |
| Purchase revenue matches policy in reports | | | | |
