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

  // Purchase guard: a reload, back/forward or a second visit to this page in the same tab must not
  // report the same transaction again. The id is recorded BEFORE the push so a thrown error cannot cause a repeat.
  var KEY = "nw_purchases_sent";
  var sent = [];
  try { sent = JSON.parse(sessionStorage.getItem(KEY)) || []; } catch (e) { sent = []; }
  if (sent.indexOf(order.transaction_id) !== -1) return;
  sent.push(order.transaction_id);
  sessionStorage.setItem(KEY, JSON.stringify(sent));

  NW.track.push("purchase", {
    transaction_id: order.transaction_id,
    value: order.value_cents / 100,
    tax: order.tax_cents / 100,
    shipping: order.shipping_cents / 100,
    currency: order.currency,
    items: NW.track.itemsFromLines(lines)
  });
})();
