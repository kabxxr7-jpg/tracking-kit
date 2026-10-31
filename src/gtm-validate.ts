import { readFileSync } from "node:fs";
import { ECOMMERCE_EVENTS } from "./validator.js";

/**
 * Best-effort structural check of a GTM container export. It checks the shapes the exports use
 * (ids, references, parameter types, trigger filters) and that this kit's nine ecommerce events are wired up.
 * It does not prove that Google Tag Manager will accept the file; that has not been tested.
 */

export const PLACEHOLDER_MEASUREMENT_ID = "G-XXXXXXXXXX";
export const PLACEHOLDER_CONTAINER_ID = "GTM-XXXXXXX";

export interface GtmValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  counts: { tags: number; triggers: number; variables: number };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

const PARAM_TYPES = new Set(["TEMPLATE", "BOOLEAN", "INTEGER", "LIST", "MAP", "TAG_REFERENCE", "TRIGGER_REFERENCE"]);
const TRIGGER_TYPES = new Set(["CUSTOM_EVENT", "PAGEVIEW", "DOM_READY", "WINDOW_LOADED", "CLICK", "LINK_CLICK", "FORM_SUBMISSION", "TIMER", "SCROLL_DEPTH", "ELEMENT_VISIBILITY", "HISTORY_CHANGE", "JS_ERROR", "YOU_TUBE_VIDEO"]);
const FIRING_OPTIONS = new Set(["ONCE_PER_EVENT", "ONCE_PER_LOAD", "UNLIMITED"]);
const BUILT_IN_TRIGGER_IDS = new Set(["2147479553", "2147479572", "2147479573"]);
const BUILT_IN_VARIABLE_NAMES = new Set(["Page URL", "Page Hostname", "Page Path", "Referrer", "Event", "Click Element", "Click URL", "Click Text", "Form Element"]);
const SPECIAL_REFERENCES = new Set(["_event"]);

function walkParams(list: unknown, where: string, errors: string[], visit: (value: string) => void): void {
  if (!Array.isArray(list)) { errors.push(`${where}: parameter must be an array`); return; }
  list.forEach((p, i) => {
    const w = `${where}.parameter[${i}]`;
    if (!isObj(p)) { errors.push(`${w}: must be an object`); return; }
    if (typeof p.type !== "string" || !PARAM_TYPES.has(p.type)) errors.push(`${w}: unknown parameter type ${JSON.stringify(p.type)}`);
    if (p.type !== "MAP" && !str(p.key) && !(p.type === "TEMPLATE" && p.key === undefined)) errors.push(`${w}: missing key`);
    if (p.type === "LIST") {
      if (!Array.isArray(p.list)) errors.push(`${w}: LIST needs a list array`);
      else p.list.forEach((entry, j) => {
        if (isObj(entry) && entry.type === "MAP") {
          if (!Array.isArray(entry.map)) errors.push(`${w}.list[${j}]: MAP needs a map array`);
          else walkParams(entry.map, `${w}.list[${j}]`, errors, visit);
        } else if (isObj(entry) && typeof entry.value === "string") visit(entry.value);
      });
    } else if (p.type === "MAP") {
      if (!Array.isArray(p.map)) errors.push(`${w}: MAP needs a map array`);
    } else if (typeof p.value !== "string") {
      errors.push(`${w}: value must be a string`);
    } else visit(p.value);
  });
}

function paramValue(list: unknown, key: string): string | undefined {
  if (!Array.isArray(list)) return undefined;
  const hit = list.find((p) => isObj(p) && p.key === key);
  return isObj(hit) && typeof hit.value === "string" ? hit.value : undefined;
}

export function validateGtmContainer(json: unknown, opts: { allowRealIds?: boolean } = {}): GtmValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const counts = { tags: 0, triggers: 0, variables: 0 };
  const fail = () => ({ ok: false, errors, warnings, counts });

  if (!isObj(json)) { errors.push("export must be a JSON object"); return fail(); }
  if (json.exportFormatVersion !== 2) errors.push(`exportFormatVersion must be 2 (got ${JSON.stringify(json.exportFormatVersion)})`);
  if (!str(json.exportTime)) errors.push("exportTime is missing");
  const cv = json.containerVersion;
  if (!isObj(cv)) { errors.push("containerVersion is missing"); return fail(); }
  for (const k of ["accountId", "containerId"]) if (!str(cv[k])) errors.push(`containerVersion.${k} is missing`);

  const container = cv.container;
  if (!isObj(container)) errors.push("containerVersion.container is missing");
  else {
    if (!str(container.publicId) || !/^GTM-[A-Z0-9]{4,}$/.test(container.publicId)) errors.push(`container.publicId must look like GTM-XXXXXXX (got ${JSON.stringify(container.publicId)})`);
    else if (container.publicId !== PLACEHOLDER_CONTAINER_ID && !opts.allowRealIds) errors.push(`container.publicId ${container.publicId} is not the placeholder ${PLACEHOLDER_CONTAINER_ID} (pass --allow-real-ids once the owner has replaced it)`);
    if (!Array.isArray(container.usageContext) || !container.usageContext.includes("WEB")) errors.push("container.usageContext must include WEB");
  }

  const tags = Array.isArray(cv.tag) ? cv.tag : (errors.push("tag must be an array"), []);
  const triggers = Array.isArray(cv.trigger) ? cv.trigger : (errors.push("trigger must be an array"), []);
  const variables = Array.isArray(cv.variable) ? cv.variable : (errors.push("variable must be an array"), []);
  counts.tags = tags.length; counts.triggers = triggers.length; counts.variables = variables.length;

  const uniq = (items: unknown[], idKey: string, kind: string) => {
    const ids = new Set<string>(); const names = new Set<string>();
    items.forEach((it, i) => {
      if (!isObj(it)) { errors.push(`${kind}[${i}] must be an object`); return; }
      for (const k of ["accountId", "containerId", idKey, "name", "fingerprint"]) if (!str(it[k])) errors.push(`${kind}[${i}] (${String(it.name ?? "?")}): missing ${k}`);
      if (str(it[idKey])) { if (ids.has(it[idKey] as string)) errors.push(`${kind}: duplicate ${idKey} ${String(it[idKey])}`); ids.add(it[idKey] as string); }
      if (str(it.name)) { if (names.has(it.name)) errors.push(`${kind}: duplicate name "${it.name}"`); names.add(it.name); }
    });
    return { ids, names };
  };
  const tagIds = uniq(tags, "tagId", "tag");
  const triggerIds = uniq(triggers, "triggerId", "trigger");
  const varIds = uniq(variables, "variableId", "variable");
  void tagIds; void varIds;

  const variableByName = new Map<string, Obj>();
  for (const v of variables) if (isObj(v) && str(v.name)) variableByName.set(v.name, v);
  const builtIns = new Set<string>(Array.isArray(cv.builtInVariable) ? (cv.builtInVariable as unknown[]).filter(isObj).map((b) => String(b.name)) : []);
  for (const b of builtIns) if (!BUILT_IN_VARIABLE_NAMES.has(b)) warnings.push(`built-in variable "${b}" is not in the list this validator knows`);

  const referencedVars = new Set<string>();
  const checkRefs = (value: string, where: string) => {
    for (const m of value.matchAll(/\{\{([^}]+)\}\}/g)) {
      const name = m[1]!;
      referencedVars.add(name);
      if (!variableByName.has(name) && !builtIns.has(name) && !SPECIAL_REFERENCES.has(name)) errors.push(`${where}: references unknown variable {{${name}}}`);
    }
  };

  // variables
  variables.forEach((v, i) => {
    if (!isObj(v)) return;
    const w = `variable[${i}] (${String(v.name)})`;
    walkParams(v.parameter, w, errors, (val) => checkRefs(val, w));
    if (v.type === "v") {
      if (!str(paramValue(v.parameter, "name"))) errors.push(`${w}: dataLayer variable needs a name parameter`);
      if (paramValue(v.parameter, "dataLayerVersion") !== "2") warnings.push(`${w}: dataLayerVersion is not 2`);
    } else if (v.type === "c") {
      if (paramValue(v.parameter, "value") === undefined) errors.push(`${w}: constant needs a value parameter`);
    } else warnings.push(`${w}: type ${JSON.stringify(v.type)} is not checked by this validator`);
  });

  // triggers
  const customEventTriggers = new Map<string, string>(); // triggerId -> event name
  triggers.forEach((t, i) => {
    if (!isObj(t)) return;
    const w = `trigger[${i}] (${String(t.name)})`;
    if (typeof t.type !== "string" || !TRIGGER_TYPES.has(t.type)) errors.push(`${w}: unknown trigger type ${JSON.stringify(t.type)}`);
    if (t.type === "CUSTOM_EVENT") {
      const filters = t.customEventFilter;
      if (!Array.isArray(filters) || filters.length === 0) { errors.push(`${w}: CUSTOM_EVENT needs customEventFilter`); return; }
      filters.forEach((f, j) => {
        if (!isObj(f) || typeof f.type !== "string") { errors.push(`${w}.customEventFilter[${j}]: missing type`); return; }
        const arg0 = paramValue(f.parameter, "arg0"); const arg1 = paramValue(f.parameter, "arg1");
        if (arg0 === undefined || arg1 === undefined) errors.push(`${w}.customEventFilter[${j}]: needs arg0 and arg1`);
        else if (f.type === "EQUALS" && arg0 === "{{_event}}" && str(t.triggerId)) customEventTriggers.set(t.triggerId, arg1);
      });
    }
  });

  // tags
  const configTags = tags.filter((t): t is Obj => isObj(t) && t.type === "gaawc");
  const configNames = new Set(configTags.map((t) => String(t.name)));
  const eventTagsByEvent = new Map<string, Obj[]>();
  const usedTriggers = new Set<string>();
  const measurementIds = new Set<string>();

  const resolveConstant = (value: string | undefined): string | undefined => {
    const m = value && /^\{\{([^}]+)\}\}$/.exec(value);
    if (!m) return value;
    const v = variableByName.get(m[1]!);
    return v && v.type === "c" ? paramValue(v.parameter, "value") : undefined;
  };

  tags.forEach((t, i) => {
    if (!isObj(t)) return;
    const w = `tag[${i}] (${String(t.name)})`;
    walkParams(t.parameter, w, errors, (val) => checkRefs(val, w));
    if (!Array.isArray(t.firingTriggerId) || t.firingTriggerId.length === 0) errors.push(`${w}: has no firingTriggerId, so it can never fire`);
    else for (const id of t.firingTriggerId) {
      if (typeof id !== "string") { errors.push(`${w}: firingTriggerId entries must be strings`); continue; }
      usedTriggers.add(id);
      if (!BUILT_IN_TRIGGER_IDS.has(id) && !triggerIds.ids.has(id)) errors.push(`${w}: firingTriggerId ${id} does not exist`);
    }
    if (typeof t.tagFiringOption !== "string" || !FIRING_OPTIONS.has(t.tagFiringOption)) errors.push(`${w}: tagFiringOption ${JSON.stringify(t.tagFiringOption)} is not a known option`);
    if (!isObj(t.consentSettings)) warnings.push(`${w}: no consentSettings`);
    if (t.type === "gaawc") {
      const mid = resolveConstant(paramValue(t.parameter, "measurementId"));
      if (!mid) errors.push(`${w}: GA4 configuration needs a measurementId`);
      else {
        measurementIds.add(mid);
        if (!/^G-[A-Z0-9]{6,}$/.test(mid)) errors.push(`${w}: measurementId ${mid} does not look like G-XXXXXXXXXX`);
        else if (mid !== PLACEHOLDER_MEASUREMENT_ID && !opts.allowRealIds) errors.push(`${w}: measurementId ${mid} is not the placeholder ${PLACEHOLDER_MEASUREMENT_ID} (pass --allow-real-ids once the owner has replaced it)`);
      }
    } else if (t.type === "gaawe") {
      const ev = paramValue(t.parameter, "eventName");
      if (!str(ev)) errors.push(`${w}: GA4 event tag needs eventName`);
      else eventTagsByEvent.set(ev, [...(eventTagsByEvent.get(ev) ?? []), t]);
      const ref = paramValue(t.parameter, "measurementId");
      const override = paramValue(t.parameter, "measurementIdOverride");
      if (!override && !(ref && configNames.has(ref))) errors.push(`${w}: measurementId must reference an existing GA4 configuration tag (got ${JSON.stringify(ref)})`);
    } else warnings.push(`${w}: tag type ${JSON.stringify(t.type)} is not checked by this validator`);
  });

  if (configTags.length !== 1) errors.push(`expected exactly one GA4 configuration tag (gaawc), found ${configTags.length}`);

  // coverage of this kit's events
  for (const ev of ECOMMERCE_EVENTS) {
    const eventTags = eventTagsByEvent.get(ev) ?? [];
    if (eventTags.length === 0) { errors.push(`no GA4 event tag for ${ev}`); continue; }
    if (eventTags.length > 1) errors.push(`${eventTags.length} GA4 event tags for ${ev} (would send the event more than once)`);
    const fires = eventTags.some((t) => Array.isArray(t.firingTriggerId) && t.firingTriggerId.some((id) => customEventTriggers.get(String(id)) === ev));
    if (!fires) errors.push(`the ${ev} tag is not fired by a CUSTOM_EVENT trigger on "${ev}"`);
  }

  // orphans
  for (const t of triggers) if (isObj(t) && str(t.triggerId) && !usedTriggers.has(t.triggerId)) warnings.push(`trigger "${String(t.name)}" is not used by any tag`);
  for (const [name] of variableByName) if (!referencedVars.has(name)) warnings.push(`variable "${name}" is not referenced`);

  return { ok: errors.length === 0, errors, warnings, counts };
}

export function validateGtmFile(file: string, opts: { allowRealIds?: boolean } = {}): GtmValidation {
  let json: unknown;
  try { json = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { return { ok: false, errors: [`cannot read ${file} as JSON: ${e instanceof Error ? e.message : String(e)}`], warnings: [], counts: { tags: 0, triggers: 0, variables: 0 } }; }
  return validateGtmContainer(json, opts);
}
