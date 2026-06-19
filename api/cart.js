/**
 * POST /api/cart          -> create a new cart, returns its state (incl. cartId)
 * GET  /api/cart?id=<id>   -> current state of a cart
 *
 * The cart is server-authoritative (Neon), so the browser and any agent share
 * the exact same cart by id.
 */
"use strict";

const { cors, readJson } = require("../lib/http");
const db = require("../lib/db");
const store = require("../lib/store");

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "POST") {
      // If the caller names a cart (e.g. the shared "demo" cart), get-or-create
      // it so the same id is reused across reloads and agent runs. Otherwise
      // mint a fresh random cart.
      const body = (await readJson(req)) || {};
      const want = body.cartId ? db.safeId(String(body.cartId)) : null;
      const row = want ? await db.getOrCreateCart(want) : await db.createCart();
      return res.status(200).json(store.computeState(row));
    }
    if (req.method === "GET") {
      const id =
        (req.query && req.query.id) ||
        new URL(req.url, "http://localhost").searchParams.get("id");
      if (!id) return res.status(400).json({ error: "Missing ?id" });
      const row = await db.getCart(id);
      if (!row) return res.status(404).json({ error: "Cart not found" });
      return res.status(200).json(store.computeState(row));
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
};
