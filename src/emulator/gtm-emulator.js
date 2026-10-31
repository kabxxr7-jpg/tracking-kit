/*
 * Minimal stand-in for gtm.js, used ONLY in offline tests and local audits.
 * It reads a container export (see gtm/container.json), replays the dataLayer in order, and for each
 * matching GA4 tag sends one beacon to https://www.google-analytics.com/g/collect (which the test harness
 * intercepts; nothing leaves the machine). It is an approximation of GTM, not GTM:
 *  - supported tag types: gaawc (GA4 configuration) and gaawe (GA4 event)
 *  - supported triggers: built-in All Pages (2147479553) and CUSTOM_EVENT with an EQUALS filter on {{_event}}
 *  - supported variables: dataLayer variable ("v") and {{_event}}
 *  - GA4 tags need analytics_storage granted; a tag's own consentSettings are honoured too
 *  - unset consent types count as granted (this is also how GTM behaves when no default is declared)
 *  - events pushed while consent is denied are NOT replayed later
 * The query string approximates the GA4 collect wire format (en, ep.*, epn.*, pr1=id..~nm..~pr..~qt.., cu, gcs).
 * It has not been compared against a real GA4 property.
 */
(function (container) {
  var cv = container.containerVersion || {};
  var tags = cv.tag || [];
  var triggers = cv.trigger || [];
  var variables = cv.variable || [];
  var ALL_PAGES = "2147479553";

  var dl = (window.dataLayer = window.dataLayer || []);
  var consent = {};
  var model = {};

  function granted(type) { return consent[type] !== "denied"; }

  function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
  function merge(target, source) {
    // GTM merges nested objects recursively; arrays and primitives replace.
    var out = isPlainObject(target) ? target : {};
    Object.keys(source).forEach(function (k) {
      out[k] = isPlainObject(source[k]) && isPlainObject(out[k]) ? merge(out[k], source[k]) : source[k];
    });
    return out;
  }
  function lookup(path) {
    var cur = model;
    var parts = path.split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function param(list, key) {
    for (var i = 0; i < (list || []).length; i++) if (list[i].key === key) return list[i];
    return null;
  }
  function paramValue(list, key) { var p = param(list, key); return p ? p.value : undefined; }

  var currentEvent = "";
  function resolveVariableByName(name) {
    if (name === "_event") return currentEvent;
    for (var i = 0; i < variables.length; i++) {
      if (variables[i].name !== name) continue;
      if (variables[i].type === "v") return lookup(paramValue(variables[i].parameter, "name"));
      if (variables[i].type === "c") return paramValue(variables[i].parameter, "value");
    }
    return undefined;
  }
  function resolve(template) {
    if (typeof template !== "string") return template;
    var whole = /^\{\{([^}]+)\}\}$/.exec(template);
    if (whole) return resolveVariableByName(whole[1]);
    return template.replace(/\{\{([^}]+)\}\}/g, function (_m, name) {
      var v = resolveVariableByName(name);
      return v == null ? "" : String(v);
    });
  }

  function triggerMatches(trigger) {
    if (trigger.type !== "CUSTOM_EVENT") return false;
    var filters = trigger.customEventFilter || [];
    for (var i = 0; i < filters.length; i++) {
      var f = filters[i];
      if (f.type !== "EQUALS") return false;
      if (String(resolve(paramValue(f.parameter, "arg0"))) !== String(resolve(paramValue(f.parameter, "arg1")))) return false;
    }
    return filters.length > 0;
  }
  function tagFires(tag) {
    var ids = tag.firingTriggerId || [];
    for (var i = 0; i < ids.length; i++) {
      if (ids[i] === ALL_PAGES && currentEvent === "gtm.js") return true;
      for (var j = 0; j < triggers.length; j++) {
        if (triggers[j].triggerId === ids[i] && triggerMatches(triggers[j])) return true;
      }
    }
    return false;
  }
  function consentAllows(tag) {
    if (!granted("analytics_storage")) return false;
    var cs = tag.consentSettings;
    if (cs && String(cs.consentStatus).toUpperCase() === "NEEDED") {
      var list = (cs.consentType && cs.consentType.list) || [];
      for (var i = 0; i < list.length; i++) if (!granted(list[i].value)) return false;
    }
    return true;
  }

  function clientId() {
    try {
      var id = sessionStorage.getItem("_tk_cid");
      if (!id) { id = String(Math.floor(Math.random() * 1e9)) + ".1700000000"; sessionStorage.setItem("_tk_cid", id); }
      return id;
    } catch (e) { return "0.0"; }
  }
  function measurementIdFor(tag) {
    var direct = paramValue(tag.parameter, "measurementIdOverride");
    if (direct) return resolve(direct);
    var ref = paramValue(tag.parameter, "measurementId");
    if (tag.type === "gaawc") return resolve(ref);
    for (var i = 0; i < tags.length; i++) if (tags[i].type === "gaawc" && tags[i].name === ref) return resolve(paramValue(tags[i].parameter, "measurementId"));
    return "";
  }

  function send(tag, eventName) {
    var q = [];
    function add(k, v) { if (v !== undefined && v !== null && v !== "") q.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(v))); }
    add("v", "2");
    add("tid", measurementIdFor(tag));
    add("gtm", container.containerVersion && container.containerVersion.container ? container.containerVersion.container.publicId : "");
    add("cid", clientId());
    add("en", eventName);
    add("gcs", "G1" + (granted("ad_storage") ? "1" : "0") + (granted("analytics_storage") ? "1" : "0"));
    add("dl", location.href);
    add("dr", document.referrer);
    add("dt", document.title);

    if (tag.type === "gaawe") {
      var send = paramValue(tag.parameter, "sendEcommerceData") === "true";
      var ecommerce = model.ecommerce;
      var settings = param(tag.parameter, "eventSettingsTable");
      var rows = (settings && settings.list) || [];
      rows.forEach(function (row) {
        var name = paramValue(row.map, "parameter");
        var value = resolve(paramValue(row.map, "parameterValue"));
        if (value === undefined || value === null || value === "") return;
        if (name === "currency") add("cu", value);
        else if (typeof value === "number") add("epn." + name, value);
        else add("ep." + name, value);
      });
      if (send && ecommerce && Array.isArray(ecommerce.items)) {
        ecommerce.items.forEach(function (it, i) {
          var parts = [];
          if (it.item_id !== undefined) parts.push("id" + it.item_id);
          if (it.item_name !== undefined) parts.push("nm" + it.item_name);
          if (it.item_brand !== undefined) parts.push("br" + it.item_brand);
          if (it.item_category !== undefined) parts.push("ca" + it.item_category);
          if (it.price !== undefined) parts.push("pr" + it.price);
          if (it.quantity !== undefined) parts.push("qt" + it.quantity);
          add("pr" + (i + 1), parts.join("~"));
        });
      }
    }
    var url = "https://www.google-analytics.com/g/collect?" + q.join("&");
    try { fetch(url, { method: "POST", mode: "no-cors", keepalive: true }); } catch (e) { /* ignored */ }
  }

  function run(eventName) {
    currentEvent = eventName;
    tags.forEach(function (tag) {
      if (tag.type !== "gaawc" && tag.type !== "gaawe") return;
      if (!tagFires(tag)) return;
      if (!consentAllows(tag)) return;
      if (tag.type === "gaawc") {
        if (paramValue(tag.parameter, "sendPageView") === "true") send(tag, "page_view");
      } else {
        send(tag, resolve(paramValue(tag.parameter, "eventName")));
      }
    });
  }

  function isCommand(msg) {
    return Object.prototype.toString.call(msg) === "[object Arguments]" || Array.isArray(msg);
  }
  function process(msg) {
    if (isCommand(msg)) {
      if (msg[0] === "consent" && (msg[1] === "default" || msg[1] === "update") && msg[2]) {
        Object.keys(msg[2]).forEach(function (k) { if (k === "wait_for_update") return; consent[k] = msg[2][k]; });
      }
      return;
    }
    if (!isPlainObject(msg)) return;
    Object.keys(msg).forEach(function (k) {
      if (k === "ecommerce" && msg[k] === null) delete model.ecommerce;
      else if (isPlainObject(msg[k])) model[k] = merge(model[k], msg[k]);
      else model[k] = msg[k];
    });
    if (typeof msg.event === "string") run(msg.event);
  }

  var snapshot = Array.prototype.slice.call(dl);
  snapshot.forEach(process);
  var originalPush = dl.push;
  dl.push = function () {
    var result = originalPush.apply(dl, arguments);
    for (var i = 0; i < arguments.length; i++) process(arguments[i]);
    return result;
  };
})(__CONTAINER_JSON__);
