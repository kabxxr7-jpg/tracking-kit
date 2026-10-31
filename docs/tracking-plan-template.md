# Tracking plan: <site name>

Copy this file per client or per site. One row per event. The plan is the contract: developers implement from it, QA tests against it, and any change to a row is a change to reporting.

| Field | Value |
|---|---|
| Site / app | |
| GA4 property id | G-XXXXXXXXXX (placeholder, replace) |
| GTM container id | GTM-XXXXXXX (placeholder, replace) |
| Currency | one ISO 4217 code, for example USD |
| Purchase `value` policy | items only / items + tax + shipping (pick one, write it here, test against it) |
| Consent mode | basic (tags load only after consent) / advanced (cookieless pings while denied) |
| Plan owner | |
| Last reviewed | |

## Event table

Status values for QA: `not started`, `in dataLayer`, `reaches GA4`, `verified in DebugView`, `verified in reports`, `blocked`.

| Event | Owner | Trigger (what the visitor does) | Fires on | Required parameters | Optional parameters | dataLayer pushed by | GTM tag / trigger | QA status | Notes |
|---|---|---|---|---|---|---|---|---|---|
| `view_item_list` | | Product list shown | Category / search page load | `items[]` | `item_list_id`, `item_list_name` | Storefront template | `GA4 - Event - view_item_list` / `CE - view_item_list` | not started | |
| `view_item` | | Product page shown | Product page load | `currency`, `value`, `items[]` | | Storefront template | | not started | |
| `add_to_cart` | | Add to cart clicked | After the cart accepted the item | `currency`, `value`, `items[]` (with `quantity`) | | Cart script | | not started | `value` = price x quantity of the added items |
| `remove_from_cart` | | Remove clicked | After the cart removed the line | `currency`, `value`, `items[]` | | Cart script | | not started | |
| `view_cart` | | Cart page shown | Cart page load, cart not empty | `currency`, `value`, `items[]` | | Cart template | | not started | |
| `begin_checkout` | | Checkout opened | First checkout step load | `currency`, `value`, `items[]` | `coupon` | Checkout template | | not started | Decide: once per session, or every load |
| `add_shipping_info` | | Shipping step submitted | After a shipping method is chosen | `currency`, `value`, `items[]`, `shipping_tier` | `coupon` | Checkout script | | not started | |
| `add_payment_info` | | Payment step submitted | After a payment type is chosen | `currency`, `value`, `items[]`, `payment_type` | `coupon` | Checkout script | | not started | Never send card data |
| `purchase` | | Order confirmed | Confirmation page, once per `transaction_id` | `transaction_id`, `currency`, `value`, `tax`, `shipping`, `items[]` | `coupon` | Confirmation template | | not started | Needs a guard against reload / back / revisit |

## Item fields

| Field | Required | Type | Rule |
|---|---|---|---|
| `item_id` | yes | string | The SKU or product id used in the catalogue, same everywhere |
| `item_name` | yes | string | Human name |
| `price` | yes | number | Unit price, no currency symbol, no quotes |
| `quantity` | cart stage and purchase | integer >= 1 | |
| `item_brand`, `item_category`, `item_variant`, `index` | no | | Add when reports need them |

## Rules every row must follow

1. Push `{ ecommerce: null }` immediately before every ecommerce push.
2. Numbers are numbers: `value`, `tax`, `shipping`, `price` are never strings and never carry a currency symbol.
3. `currency` is present wherever `value` is, and is the same on every event of a session.
4. No personal data in any parameter or in a URL that becomes `page_location`: no email, name, phone, address, or an id that is really an email.
5. Nothing is sent to Google before the consent default is declared and analytics consent is granted (basic mode).
6. `purchase` is reported once per `transaction_id`.

## Custom (non-ecommerce) events

| Event | Owner | Trigger | Parameters | Registered as custom dimension / metric? | QA status |
|---|---|---|---|---|---|
| | | | | | |

## Change log

| Date | Change | By |
|---|---|---|
| | | |
