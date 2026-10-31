// Regenerates gtm/container.json. The export is committed; this script only exists so the nine
// event tags, triggers and variables stay consistent with each other. Placeholder ids only.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ACCOUNT = "0000000000";
const CONTAINER = "0000000000";
const MEASUREMENT_ID = "G-XXXXXXXXXX";
const PUBLIC_ID = "GTM-XXXXXXX";
const ALL_PAGES = "2147479553";
const base = { accountId: ACCOUNT, containerId: CONTAINER };

const EVENTS = {
  view_item_list: ["item_list_id", "item_list_name"],
  view_item: ["currency", "value"],
  add_to_cart: ["currency", "value"],
  remove_from_cart: ["currency", "value"],
  view_cart: ["currency", "value"],
  begin_checkout: ["currency", "value"],
  add_shipping_info: ["currency", "value", "shipping_tier"],
  add_payment_info: ["currency", "value", "payment_type"],
  purchase: ["transaction_id", "currency", "value", "tax", "shipping"]
};

const dlvNames = [...new Set(Object.values(EVENTS).flat())];
const dlvName = (p) => `DLV - ecommerce.${p}`;

const variable = dlvNames.map((p, i) => ({
  ...base,
  variableId: String(20 + i),
  name: dlvName(p),
  type: "v",
  parameter: [
    { type: "INTEGER", key: "dataLayerVersion", value: "2" },
    { type: "BOOLEAN", key: "setDefaultValue", value: "false" },
    { type: "TEMPLATE", key: "name", value: `ecommerce.${p}` }
  ],
  fingerprint: "0",
  formatValue: {}
}));
variable.push({
  ...base,
  variableId: "40",
  name: "Const - GA4 Measurement ID",
  type: "c",
  parameter: [{ type: "TEMPLATE", key: "value", value: MEASUREMENT_ID }],
  fingerprint: "0",
  formatValue: {}
});

const trigger = Object.keys(EVENTS).map((ev, i) => ({
  ...base,
  triggerId: String(10 + i),
  name: `CE - ${ev}`,
  type: "CUSTOM_EVENT",
  customEventFilter: [
    {
      type: "EQUALS",
      parameter: [
        { type: "TEMPLATE", key: "arg0", value: "{{_event}}" },
        { type: "TEMPLATE", key: "arg1", value: ev }
      ]
    }
  ],
  fingerprint: "0"
}));

const consentSettings = {
  consentStatus: "NEEDED",
  consentType: { type: "LIST", list: [{ type: "TEMPLATE", value: "analytics_storage" }] }
};
const CONFIG_NAME = "GA4 - Configuration";

const tag = [
  {
    ...base,
    tagId: "1",
    name: CONFIG_NAME,
    type: "gaawc",
    parameter: [
      { type: "BOOLEAN", key: "sendPageView", value: "true" },
      { type: "TEMPLATE", key: "measurementId", value: "{{Const - GA4 Measurement ID}}" }
    ],
    fingerprint: "0",
    firingTriggerId: [ALL_PAGES],
    tagFiringOption: "ONCE_PER_EVENT",
    monitoringMetadata: { type: "MAP" },
    consentSettings
  },
  ...Object.entries(EVENTS).map(([ev, params], i) => ({
    ...base,
    tagId: String(2 + i),
    name: `GA4 - Event - ${ev}`,
    type: "gaawe",
    parameter: [
      { type: "BOOLEAN", key: "sendEcommerceData", value: "true" },
      { type: "TEMPLATE", key: "eventName", value: ev },
      { type: "TAG_REFERENCE", key: "measurementId", value: CONFIG_NAME },
      {
        type: "LIST",
        key: "eventSettingsTable",
        list: params.map((p) => ({
          type: "MAP",
          map: [
            { type: "TEMPLATE", key: "parameter", value: p },
            { type: "TEMPLATE", key: "parameterValue", value: `{{${dlvName(p)}}}` }
          ]
        }))
      },
      { type: "TEMPLATE", key: "getEcommerceDataFrom", value: "dataLayer" }
    ],
    fingerprint: "0",
    firingTriggerId: [String(10 + i)],
    tagFiringOption: "ONCE_PER_EVENT",
    monitoringMetadata: { type: "MAP" },
    consentSettings
  }))
];

const containerPath = `accounts/${ACCOUNT}/containers/${CONTAINER}`;
const out = {
  exportFormatVersion: 2,
  exportTime: "2026-10-31 00:00:00",
  containerVersion: {
    path: `${containerPath}/versions/0`,
    ...base,
    containerVersionId: "0",
    container: {
      path: containerPath,
      ...base,
      name: "Northwind Pots (placeholder container)",
      publicId: PUBLIC_ID,
      usageContext: ["WEB"],
      fingerprint: "0",
      tagManagerUrl: `https://tagmanager.google.com/#/container/${containerPath}/workspaces?apiLink=container`,
      features: {},
      tagIds: [PUBLIC_ID]
    },
    tag,
    trigger,
    variable,
    builtInVariable: ["PAGE_URL", "PAGE_HOSTNAME", "PAGE_PATH", "REFERRER", "EVENT"].map((type) => ({
      ...base,
      type,
      name: { PAGE_URL: "Page URL", PAGE_HOSTNAME: "Page Hostname", PAGE_PATH: "Page Path", REFERRER: "Referrer", EVENT: "Event" }[type]
    })),
    fingerprint: "0",
    tagManagerUrl: `https://tagmanager.google.com/#/versions/${containerPath}/versions/0?apiLink=version`
  }
};

const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "gtm", "container.json");
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${target}: ${tag.length} tags, ${trigger.length} triggers, ${variable.length} variables`);
