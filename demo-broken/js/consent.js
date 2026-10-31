/*
 * DELIBERATELY BROKEN twin of demo/js/consent.js (used to prove the validator catches the bug).
 * BUG 1: no consent default is declared, so every consent type counts as granted.
 * BUG 2: the tag manager is requested on page load, before the visitor has chosen anything.
 * The banner exists, but it only records a choice after the tags have already fired.
 */
(function () {
  var CONTAINER_ID = "GTM-XXXXXXX";
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
  var s = document.createElement("script");
  s.async = true;
  s.src = "https://www.googletagmanager.com/gtm.js?id=" + CONTAINER_ID;
  document.head.appendChild(s);

  var KEY = "nw_consent";
  var stored = null;
  try { stored = localStorage.getItem(KEY); } catch (e) {}

  document.addEventListener("DOMContentLoaded", function () {
    function show() {
      if (document.getElementById("consent-banner")) return;
      var b = document.createElement("div");
      b.id = "consent-banner";
      b.innerHTML =
        "<p>We use cookies to measure the site.</p>" +
        '<button id="consent-accept-all" type="button">Accept all</button>' +
        '<button id="consent-analytics-only" type="button" class="secondary">Analytics only</button>' +
        '<button id="consent-reject" type="button" class="secondary">Reject</button>';
      document.body.appendChild(b);
      function done(choice) {
        try { localStorage.setItem(KEY, choice); } catch (e) {}
        gtag("consent", "update", { analytics_storage: choice === "reject" ? "denied" : "granted" });
        b.remove();
      }
      b.querySelector("#consent-accept-all").addEventListener("click", function () { done("all"); });
      b.querySelector("#consent-analytics-only").addEventListener("click", function () { done("analytics"); });
      b.querySelector("#consent-reject").addEventListener("click", function () { done("reject"); });
    }
    if (!stored) show();
    var settings = document.getElementById("cookie-settings");
    if (settings) settings.addEventListener("click", show);
  });
})();
