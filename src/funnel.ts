import type { Page } from "playwright-core";
import type { Harness } from "./harness.js";

/** Walks the Northwind Pots demo (or its broken twin) from the list page to the thank-you page. */

export interface WalkOptions {
  /** Click a button on the consent banner after the first page loads. Omit to leave the banner alone. */
  consent?: "all" | "analytics" | "reject";
  email?: string;
  name?: string;
  address?: string;
  shipping?: "standard" | "express";
  payment?: "Credit Card" | "PayPal" | "Gift Card";
}

export interface WalkResult {
  transactionId: string;
  email: string;
  thankYouUrl: string;
  /** Expected purchase figures in dollars for the fixed basket the walk builds. */
  expected: { subtotal: number; tax: number; shipping: number; value: number };
}

const BASKET = { a: "NW-PLANT-12", aQty: "2", b: "NW-GLAZE-20", c: "NW-TROWEL" };

export async function walkFunnel(page: Page, harness: Harness, baseUrl: string, opts: WalkOptions = {}): Promise<WalkResult> {
  const email = opts.email ?? "casey.example@example.test";
  const shipping = opts.shipping ?? "express";
  const settle = () => harness.quiesce();

  await page.goto(baseUrl + "/");
  await page.waitForSelector("#product-list");
  await settle();
  if (opts.consent) {
    const id = { all: "#consent-accept-all", analytics: "#consent-analytics-only", reject: "#consent-reject" }[opts.consent];
    await page.click(id);
    await settle();
  }

  // two Terracotta planters, one Glazed pot, two trowels (the trowels are removed again in the cart)
  const add = async (id: string, qty: string) => {
    await page.goto(`${baseUrl}/product.html?id=${id}`);
    await page.waitForSelector("#add-to-cart");
    await page.selectOption("#qty", qty);
    await settle();
    await page.click("#add-to-cart");
    await page.waitForSelector("#added:not([hidden])");
    await settle();
  };
  await add(BASKET.a, BASKET.aQty);
  await add(BASKET.b, "1");
  await add(BASKET.c, "2");

  await page.click("#go-to-cart");
  await page.waitForSelector("#cart-table");
  await settle();
  await page.click(`[data-remove="${BASKET.c}"]`);
  await settle();

  await page.click("#checkout-link");
  await page.waitForSelector("#shipping-form");
  await settle();
  await page.fill("#email", email);
  await page.fill("#full-name", opts.name ?? "Casey Example");
  await page.fill("#address", opts.address ?? "1 Example Street");
  await page.selectOption("#shipping-method", shipping);
  await page.click("#continue-payment");
  await page.waitForSelector("#payment-form:not([hidden])");
  await settle();
  await page.selectOption("#payment-type", opts.payment ?? "PayPal");
  await Promise.all([page.waitForURL("**/thank-you.html**"), page.click("#place-order")]);
  await page.waitForSelector("#order-id");
  await settle();

  const transactionId = (await page.textContent("#order-id")) ?? "";
  const subtotal = 18.0 * 2 + 34.5;
  const tax = Math.round(subtotal * 8) / 100;
  const ship = shipping === "express" ? 11.95 : 4.95;
  return {
    transactionId,
    email,
    thankYouUrl: page.url(),
    expected: { subtotal, tax, shipping: ship, value: Math.round((subtotal + tax + ship) * 100) / 100 }
  };
}
