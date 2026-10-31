(function () {
  var app = document.getElementById("app");
  var lines = NW.cart.lines();
  if (!lines.length) {
    app.innerHTML = "<h1>Checkout</h1><p id='checkout-empty'>Nothing to check out. <a href='/'>Back to the shop</a></p>";
    return;
  }
  var subtotal = NW.subtotalCents(lines);
  var contact = null;
  var shippingKey = "standard";

  app.innerHTML =
    "<h1>Checkout</h1>" +
    "<div class='note'>Demo only: use made-up details. Nothing is sent anywhere and no card number is asked for.</div>" +
    "<form id='shipping-form'><fieldset><legend>1. Shipping</legend>" +
    "<label for='email'>Email</label><input id='email' type='email' required>" +
    "<label for='full-name'>Full name</label><input id='full-name' required>" +
    "<label for='address'>Address</label><input id='address' required>" +
    "<label for='shipping-method'>Shipping method</label><select id='shipping-method'>" +
    "<option value='standard'>Standard ($4.95)</option><option value='express'>Express ($11.95)</option></select>" +
    "<p><button id='continue-payment' type='submit'>Continue to payment</button></p></fieldset></form>" +
    "<form id='payment-form' hidden><fieldset><legend>2. Payment</legend>" +
    "<label for='payment-type'>Payment type</label><select id='payment-type'>" +
    "<option>Credit Card</option><option>PayPal</option><option>Gift Card</option></select>" +
    "<p><button id='place-order' type='submit'>Place order</button></p></fieldset></form>" +
    "<div id='order-summary'></div>";

  function totals() {
    var shipping = NW.shipping[shippingKey].cents;
    var tax = NW.taxCents(subtotal);
    return { subtotal: subtotal, tax: tax, shipping: shipping, total: subtotal + tax + shipping };
  }
  function renderSummary() {
    var t = totals();
    document.getElementById("order-summary").innerHTML =
      "<p>Subtotal " + NW.money(t.subtotal) + " | Tax " + NW.money(t.tax) + " | Shipping " + NW.money(t.shipping) +
      " | <strong id='order-total'>Total " + NW.money(t.total) + "</strong></p>";
  }
  renderSummary();

  NW.track.push("begin_checkout", {
    currency: NW.track.currency,
    value: subtotal / 100,
    items: NW.track.itemsFromLines(lines)
  });

  document.getElementById("shipping-method").addEventListener("change", function (e) {
    shippingKey = e.target.value;
    renderSummary();
  });

  document.getElementById("shipping-form").addEventListener("submit", function (e) {
    e.preventDefault();
    contact = {
      email: document.getElementById("email").value,
      name: document.getElementById("full-name").value,
      address: document.getElementById("address").value
    };
    NW.track.push("add_shipping_info", {
      currency: NW.track.currency,
      value: subtotal / 100,
      shipping_tier: NW.shipping[shippingKey].label,
      items: NW.track.itemsFromLines(lines)
    });
    document.getElementById("payment-form").hidden = false;
    document.getElementById("continue-payment").disabled = true;
  });

  document.getElementById("payment-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var paymentType = document.getElementById("payment-type").value;
    NW.track.push("add_payment_info", {
      currency: NW.track.currency,
      value: subtotal / 100,
      payment_type: paymentType,
      items: NW.track.itemsFromLines(lines)
    });
    var t = totals();
    var transactionId = "NW-" + String(Date.now()).slice(-8);
    var order = {
      transaction_id: transactionId,
      currency: NW.track.currency,
      value_cents: t.total,
      tax_cents: t.tax,
      shipping_cents: t.shipping,
      lines: lines.map(function (l) { return { id: l.product.id, qty: l.qty }; })
    };
    sessionStorage.setItem("nw_order", JSON.stringify(order));
    sessionStorage.setItem("nw_contact", JSON.stringify(contact));
    NW.cart.clear();
    location.href = "/thank-you.html?order=" + encodeURIComponent(transactionId);
  });
})();
