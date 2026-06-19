/**
 * POST /api/cart-items
 * Body: { cartId, action, itemId?, qty?, view? }
 *   action = "add" | "remove" | "setqty" | "clear" | "setview"
 *
 * Mutates a server-side cart and returns the new state. This is the endpoint an
 * agent calls to add/remove items; the browser polling the same cart then shows
 * the change.
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
    const { cartId, action, itemId, qty, view } = (await readJson(req)) || {};
    if (!cartId) return res.status(400).json({ error: "Missing cartId" });

    const row = await db.getCart(cartId);
    if (!row) return res.status(404).json({ error: "Cart not found" });

    const cart = row.cart || {};
    let nextView = row.view || "menus";

    switch (action) {
      case "add":
        store.addItem(cart, itemId, qty);
        break;
      case "remove":
        store.removeItem(cart, itemId);
        break;
      case "setqty":
        store.setQuantity(cart, itemId, qty);
        break;
      case "clear":
        store.clearCart(cart);
        break;
      case "setview":
        if (["menus", "checkout", "confirmation"].includes(view)) nextView = view;
        break;
      default:
        return res.status(400).json({ error: "Unknown action: " + action });
    }

    await db.saveCart(cartId, { cart, view: nextView, lastOrder: row.last_order || null });
    return res
      .status(200)
      .json(store.computeState({ id: cartId, cart, view: nextView, last_order: row.last_order || null }));
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
};
