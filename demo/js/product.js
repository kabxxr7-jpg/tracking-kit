(function () {
  var app = document.getElementById("app");
  var id = new URLSearchParams(location.search).get("id");
  var p = NW.find(id);
  if (!p) { app.innerHTML = "<h1>Product not found</h1><p><a href='/'>Back to the shop</a></p>"; return; }

  app.innerHTML =
    "<h1 id='product-name'>" + p.name + "</h1><p class='price'>" + NW.money(p.cents) + "</p>" +
    "<label for='qty'>Quantity</label><select id='qty'><option>1</option><option>2</option><option>3</option></select>" +
    "<p><button id='add-to-cart' type='button'>Add to cart</button></p>" +
    "<p id='added' hidden>Added to cart. <a id='go-to-cart' href='/cart.html'>View cart</a></p>";

  NW.track.push("view_item", {
    currency: NW.track.currency,
    value: p.cents / 100,
    items: [NW.track.item(p, 1)]
  });

  document.getElementById("add-to-cart").addEventListener("click", function () {
    var qty = parseInt(document.getElementById("qty").value, 10);
    NW.cart.add(p.id, qty);
    NW.track.push("add_to_cart", {
      currency: NW.track.currency,
      value: (p.cents * qty) / 100,
      items: [NW.track.item(p, qty)]
    });
    document.getElementById("added").hidden = false;
  });
})();
