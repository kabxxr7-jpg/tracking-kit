(function () {
  var app = document.getElementById("app");
  var order = null, contact = null;
  try { order = JSON.parse(sessionStorage.getItem("nw_order")); contact = JSON.parse(sessionStorage.getItem("nw_contact")); } catch (e) { /* treated as no order */ }
  if (!order) {
    app.innerHTML = "<h1>Thank you</h1><p id='no-order'>No recent order found in this tab. <a href='/'>Back to the shop</a></p>";
    return;
  }
  var lines = order.lines.map(function (l) { return { product: NW.find(l.id), qty: l.qty }; });
  app.innerHTML =
    "<h1>Thank you for your order</h1><p>Order <strong id='order-id'>" + order.transaction_id + "</strong></p>" +
    "<p>A confirmation would be sent to " + (contact ? contact.email : "you") + " (demo: nothing is sent).</p>" +
    "<p id='order-total'>Total " + NW.money(order.value_cents) + "</p><p><a href='/'>Keep shopping</a></p>";

  // BUG 6: there is no purchase guard, so every reload or back/forward reports the same transaction again.
  // BUG 7: value is a formatted string with a currency symbol instead of a number.
  // BUG 8: the shopper's email address is pushed as a top-level field next to the event.
  window.dataLayer.push({
    event: "purchase",
    user_email: contact ? contact.email : undefined,
    ecommerce: {
      transaction_id: order.transaction_id,
      value: "$" + (order.value_cents / 100).toFixed(2),
      tax: order.tax_cents / 100,
      shipping: order.shipping_cents / 100,
      currency: order.currency,
      items: NW.track.itemsFromLines(lines)
    }
  });
})();
