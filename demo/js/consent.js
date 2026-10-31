/*
 * Consent Mode v2, "basic" implementation.
 * 1. Default state is DENIED for all four consent types, set before any tag code exists.
 * 2. Google Tag Manager is not requested until the visitor grants at least one type.
 * 3. A stored choice is replayed on every page load (update first, then the tag manager).
 * The container id below is an obvious placeholder.
 */
(function () {
  var CONTAINER_ID = "GTM-XXXXXXX";
  var KEY = "nw_consent";

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("consent", "default", {
    ad_storage: "denied",
    analytics_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied"
  });

  function readChoice() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function writeChoice(choice) {
    try { localStorage.setItem(KEY, choice); } catch (e) { /* storage blocked: choice lasts for this page only */ }
  }
  function toConsent(choice) {
    var analytics = choice === "all" || choice === "analytics" ? "granted" : "denied";
    var ads = choice === "all" ? "granted" : "denied";
    return { analytics_storage: analytics, ad_storage: ads, ad_user_data: ads, ad_personalization: ads };
  }

  var tagManagerRequested = false;
  function loadTagManager() {
    if (tagManagerRequested) return;
    tagManagerRequested = true;
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtm.js?id=" + CONTAINER_ID;
    document.head.appendChild(s);
  }

  function apply(choice) {
    gtag("consent", "update", toConsent(choice));
    if (choice !== "reject") loadTagManager();
  }

  function removeBanner() {
    var b = document.getElementById("consent-banner");
    if (b) b.remove();
  }

  function showBanner() {
    if (document.getElementById("consent-banner")) return;
    var b = document.createElement("div");
    b.id = "consent-banner";
    b.setAttribute("role", "dialog");
    b.setAttribute("aria-label", "Cookie consent");
    b.innerHTML =
      "<p>Northwind Pots (a fictional shop) would like to measure how the site is used. " +
      "You can allow analytics only, allow analytics and advertising, or reject both.</p>" +
      '<button id="consent-accept-all" type="button">Accept all</button>' +
      '<button id="consent-analytics-only" type="button" class="secondary">Analytics only</button>' +
      '<button id="consent-reject" type="button" class="secondary">Reject</button>';
    document.body.appendChild(b);
    function choose(choice) { writeChoice(choice); apply(choice); removeBanner(); }
    b.querySelector("#consent-accept-all").addEventListener("click", function () { choose("all"); });
    b.querySelector("#consent-analytics-only").addEventListener("click", function () { choose("analytics"); });
    b.querySelector("#consent-reject").addEventListener("click", function () { choose("reject"); });
  }

  var stored = readChoice();
  if (stored) apply(stored);

  document.addEventListener("DOMContentLoaded", function () {
    if (!stored) showBanner();
    var settings = document.getElementById("cookie-settings");
    if (settings) settings.addEventListener("click", showBanner);
  });
})();
