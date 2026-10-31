(function () {
  var app = document.getElementById("app");

  function render() {
    var lines = NW.cart.lines();
    if (!lines.length) {
      app.innerHTML = "<h1>Your cart</h1><p id='cart-empty'>Your cart is empty.</p><p><a href='/'>Keep shopping</a></p>";
      return lines;
    }
    var html = "<h1>Your cart</h1><table id='cart-table'><tr><th>Item</th><th>Qty</th><th>Price</th><th></th></tr>";
    lines.forEach(function (l) {
      html += "<tr><td>" + l.product.name + "</td><td>" + l.qty + "</td><td>" + NW.money(l.product.cents * l.qty) +
        "</td><td><button type='button' class='secondary' data-remove='" + l.product.id + "'>Remove</button></td></tr>";
    });
    html += "</table><p>Subtotal: <strong id='subtotal'>" + NW.money(NW.subtotalCents(lines)) + "</strong></p>" +
      "<p><a class='btn' id='checkout-link' href='/checkout.html'>Checkout</a></p>";
    app.innerHTML = html;
    Array.prototype.forEach.call(app.querySelectorAll("[data-remove]"), function (btn) {
      btn.addEventListener("click", function () { removeLine(btn.getAttribute("data-remove")); });
    });
    return lines;
  }

  function removeLine(id) {
    var line = NW.cart.lines().filter(function (l) { return l.product.id === id; })[0];
    if (!line) return;
    NW.cart.remove(id);
    NW.track.push("remove_from_cart", {
      currency: NW.track.currency,
      value: (line.product.cents * line.qty) / 100,
      items: [NW.track.item(line.product, line.qty)]
    });
    render();
  }

  var lines = render();
  if (lines.length) {
    NW.track.push("view_cart", {
      currency: NW.track.currency,
      value: NW.subtotalCents(lines) / 100,
      items: NW.track.itemsFromLines(lines)
    });
  }
})();
