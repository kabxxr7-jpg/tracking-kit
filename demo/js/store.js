/* Catalogue, cart and money helpers for the fictional Northwind Pots shop. All amounts are integer cents. */
(function () {
  var PRODUCTS = [
    { id: "NW-PLANT-12", name: "Terracotta Planter 12 cm", category: "Planters", cents: 1800 },
    { id: "NW-GLAZE-20", name: "Glazed Blue Pot 20 cm", category: "Planters", cents: 3450 },
    { id: "NW-HERB-3", name: "Herb Pot Trio", category: "Planters", cents: 2400 },
    { id: "NW-HANG-15", name: "Hanging Pot with Rope", category: "Planters", cents: 2950 },
    { id: "NW-SAUCER-4", name: "Saucer Set of 4", category: "Accessories", cents: 1250 },
    { id: "NW-TROWEL", name: "Hand Trowel", category: "Tools", cents: 1595 }
  ];
  var CART_KEY = "nw_cart";
  var SHIPPING = { standard: { label: "Standard", cents: 495 }, express: { label: "Express", cents: 1195 } };

  function find(id) {
    for (var i = 0; i < PRODUCTS.length; i++) if (PRODUCTS[i].id === id) return PRODUCTS[i];
    return null;
  }
  function readCart() {
    try { return JSON.parse(sessionStorage.getItem(CART_KEY)) || []; } catch (e) { return []; }
  }
  function writeCart(lines) { sessionStorage.setItem(CART_KEY, JSON.stringify(lines)); }

  var cart = {
    lines: function () {
      return readCart().map(function (l) { return { product: find(l.id), qty: l.qty }; }).filter(function (l) { return l.product; });
    },
    add: function (id, qty) {
      var lines = readCart();
      var hit = lines.filter(function (l) { return l.id === id; })[0];
      if (hit) hit.qty += qty; else lines.push({ id: id, qty: qty });
      writeCart(lines);
    },
    remove: function (id) { writeCart(readCart().filter(function (l) { return l.id !== id; })); },
    clear: function () { sessionStorage.removeItem(CART_KEY); }
  };

  function subtotalCents(lines) {
    return lines.reduce(function (sum, l) { return sum + l.product.cents * l.qty; }, 0);
  }
  function taxCents(subtotal) { return Math.round(subtotal * 0.08); }
  function money(cents) { return "$" + (cents / 100).toFixed(2); }

  window.NW = { products: PRODUCTS, find: find, cart: cart, shipping: SHIPPING, subtotalCents: subtotalCents, taxCents: taxCents, money: money };
})();
