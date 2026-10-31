(function () {
  var app = document.getElementById("app");
  var html = "<h1>All pots</h1><div class='grid' id='product-list'>";
  NW.products.forEach(function (p) {
    html += "<div class='card' data-product='" + p.id + "'><a href='/product.html?id=" + p.id + "'>" + p.name + "</a>" +
      "<p class='price'>" + NW.money(p.cents) + "</p></div>";
  });
  app.innerHTML = html + "</div>";

  NW.track.push("view_item_list", {
    item_list_id: "all_pots",
    item_list_name: "All pots",
    items: NW.products.map(function (p, i) { return NW.track.item(p, null, i); })
  });
})();
