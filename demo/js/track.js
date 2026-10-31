/*
 * dataLayer helpers. Every ecommerce event follows the GTM recommendation:
 * push { ecommerce: null } first so values from the previous event cannot leak into this one.
 */
(function () {
  var CURRENCY = "USD";

  function item(product, qty, index) {
    var it = {
      item_id: product.id,
      item_name: product.name,
      item_brand: "Northwind Pots",
      item_category: product.category,
      price: product.cents / 100
    };
    if (qty != null) it.quantity = qty;
    if (index != null) it.index = index;
    return it;
  }
  function itemsFromLines(lines) {
    return lines.map(function (l, i) { return item(l.product, l.qty, i); });
  }
  function push(eventName, ecommerce) {
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: eventName, ecommerce: ecommerce });
  }

  window.NW.track = { currency: CURRENCY, item: item, itemsFromLines: itemsFromLines, push: push };
})();
