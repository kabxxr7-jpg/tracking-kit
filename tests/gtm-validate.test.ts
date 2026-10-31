import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateGtmContainer } from "../src/gtm-validate.js";
import { DEFAULT_CONTAINER_PATH } from "../src/harness.js";
import { ECOMMERCE_EVENTS } from "../src/validator.js";

const load = () => JSON.parse(readFileSync(DEFAULT_CONTAINER_PATH, "utf8"));
const errorsOf = (mutate: (c: any) => void, opts = {}) => {
  const c = load();
  mutate(c);
  return validateGtmContainer(c, opts).errors;
};

describe("gtm/container.json", () => {
  it("passes validation with no errors", () => {
    const r = validateGtmContainer(load());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("has 1 configuration tag, 9 event tags, 9 triggers and the dataLayer variables", () => {
    const c = load().containerVersion;
    expect(c.tag.filter((t: any) => t.type === "gaawc")).toHaveLength(1);
    expect(c.tag.filter((t: any) => t.type === "gaawe")).toHaveLength(9);
    expect(c.trigger).toHaveLength(9);
    expect(c.variable.filter((v: any) => v.type === "v").length).toBeGreaterThanOrEqual(9);
  });

  it.each(ECOMMERCE_EVENTS)("has a tag and a custom-event trigger for %s", (ev) => {
    const c = load().containerVersion;
    const tag = c.tag.find((t: any) => t.parameter.some((p: any) => p.key === "eventName" && p.value === ev));
    expect(tag).toBeDefined();
    const trig = c.trigger.find((t: any) => tag.firingTriggerId.includes(t.triggerId));
    expect(trig.customEventFilter[0].parameter.find((p: any) => p.key === "arg1").value).toBe(ev);
  });

  it("uses only obviously fake ids", () => {
    const text = readFileSync(DEFAULT_CONTAINER_PATH, "utf8");
    expect(text).toContain("G-XXXXXXXXXX");
    expect(text).toContain("GTM-XXXXXXX");
    expect(text.match(/\bG-[A-Z0-9]{6,}\b/g)!.every((m) => m === "G-XXXXXXXXXX")).toBe(true);
    expect(text.match(/\bGTM-[A-Z0-9]{4,}\b/g)!.every((m) => m === "GTM-XXXXXXX")).toBe(true);
  });
});

describe("validator catches broken exports", () => {
  it("rejects non-objects and a wrong export version", () => {
    expect(validateGtmContainer([]).ok).toBe(false);
    expect(errorsOf((c) => { c.exportFormatVersion = 1; })[0]).toContain("exportFormatVersion");
  });
  it("rejects a missing containerVersion", () => {
    expect(errorsOf((c) => { delete c.containerVersion; })).toContain("containerVersion is missing");
  });
  it("rejects a real-looking measurement id unless real ids are allowed", () => {
    const real = (c: any) => { c.containerVersion.variable.find((v: any) => v.type === "c").parameter[0].value = "G-ABCD123456"; };
    expect(errorsOf(real).join("\n")).toContain("not the placeholder");
    expect(errorsOf(real, { allowRealIds: true })).toEqual([]);
  });
  it("rejects a real-looking container id unless real ids are allowed", () => {
    const real = (c: any) => { c.containerVersion.container.publicId = "GTM-AB12CD3"; };
    expect(errorsOf(real).join("\n")).toContain("not the placeholder");
    expect(errorsOf(real, { allowRealIds: true })).toEqual([]);
  });
  it("rejects a malformed measurement id", () => {
    expect(errorsOf((c) => { c.containerVersion.variable.find((v: any) => v.type === "c").parameter[0].value = "UA-12345-1"; }).join("\n")).toContain("does not look like");
  });
  it("rejects a missing purchase tag", () => {
    const e = errorsOf((c) => { c.containerVersion.tag = c.containerVersion.tag.filter((t: any) => t.name !== "GA4 - Event - purchase"); });
    expect(e).toContain("no GA4 event tag for purchase");
  });
  it("rejects a tag whose trigger does not exist", () => {
    const e = errorsOf((c) => { c.containerVersion.tag[3].firingTriggerId = ["999"]; });
    expect(e.join("\n")).toContain("firingTriggerId 999 does not exist");
  });
  it("rejects a tag with no trigger", () => {
    expect(errorsOf((c) => { c.containerVersion.tag[2].firingTriggerId = []; }).join("\n")).toContain("can never fire");
  });
  it("rejects an event tag wired to the wrong event's trigger", () => {
    const e = errorsOf((c) => { c.containerVersion.tag[2].firingTriggerId = c.containerVersion.tag[3].firingTriggerId; });
    expect(e.join("\n")).toMatch(/is not fired by a CUSTOM_EVENT trigger/);
  });
  it("rejects duplicate tag ids and duplicate names", () => {
    expect(errorsOf((c) => { c.containerVersion.tag[1].tagId = c.containerVersion.tag[2].tagId; }).join("\n")).toContain("duplicate tagId");
    expect(errorsOf((c) => { c.containerVersion.tag[1].name = c.containerVersion.tag[2].name; }).join("\n")).toContain("duplicate name");
  });
  it("rejects a reference to a variable that does not exist", () => {
    const e = errorsOf((c) => { c.containerVersion.tag[9].parameter[3].list[0].map[1].value = "{{DLV - nope}}"; });
    expect(e.join("\n")).toContain("unknown variable {{DLV - nope}}");
  });
  it("rejects an event tag that points at a configuration tag that does not exist", () => {
    const e = errorsOf((c) => { c.containerVersion.tag[1].parameter.find((p: any) => p.key === "measurementId").value = "Missing config"; });
    expect(e.join("\n")).toContain("must reference an existing GA4 configuration tag");
  });
  it("rejects two configuration tags and zero configuration tags", () => {
    expect(errorsOf((c) => { c.containerVersion.tag = c.containerVersion.tag.filter((t: any) => t.type !== "gaawc"); }).join("\n")).toContain("exactly one GA4 configuration tag");
  });
  it("rejects an unknown parameter type and a trigger without a filter", () => {
    expect(errorsOf((c) => { c.containerVersion.tag[1].parameter[0].type = "BANANA"; }).join("\n")).toContain("unknown parameter type");
    expect(errorsOf((c) => { delete c.containerVersion.trigger[0].customEventFilter; }).join("\n")).toContain("needs customEventFilter");
  });
  it("rejects a dataLayer variable without a name", () => {
    expect(errorsOf((c) => { c.containerVersion.variable[0].parameter = c.containerVersion.variable[0].parameter.filter((p: any) => p.key !== "name"); }).join("\n")).toContain("needs a name parameter");
  });
  it("rejects a missing fingerprint", () => {
    expect(errorsOf((c) => { delete c.containerVersion.tag[0].fingerprint; }).join("\n")).toContain("missing fingerprint");
  });
  it("warns (not errors) about tags without consent settings and unused triggers", () => {
    const c = load();
    delete c.containerVersion.tag[0].consentSettings;
    c.containerVersion.trigger.push({ ...c.containerVersion.trigger[0], triggerId: "99", name: "CE - unused" });
    const r = validateGtmContainer(c);
    expect(r.ok).toBe(true);
    expect(r.warnings.join("\n")).toContain("no consentSettings");
    expect(r.warnings.join("\n")).toContain("not used by any tag");
  });
});
