/**
 * POST /api/checkout
 * Body: { cartId, name, address, card }
 *
 * Places the order (payment is simulated — any card value works), clears the
 * cart, flips the cart to the "confirmation" view, and returns the receipt.
 * Fails if the cart is empty or any delivery field is missing.
 */
"use strict";

const { cors, readJson } = require("../lib/http");
const db = require("../lib/db");
const store = require("../lib/store");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { cartId, name, address, card } = (await readJson(req)) || {};
    if (!cartId) return res.status(400).json({ error: "Missing cartId" });

    const row = await db.getCart(cartId);
    if (!row) return res.status(404).json({ error: "Cart not found" });

    const cart = row.cart || {};
    const order = store.buildOrder(cart, { name, address, card }); // throws if invalid

    store.clearCart(cart);
    await db.saveCart(cartId, { cart, view: "confirmation", lastOrder: order });

    return res.status(200).json({
      receipt: order,
      state: store.computeState({ id: cartId, cart, view: "confirmation", last_order: order }),
    });
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
};
