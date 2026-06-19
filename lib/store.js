/**
 * Agent Menu — server-side cart logic (shared by all /api functions).
 *
 * This is the single source of truth for cart math (subtotal, delivery fee,
 * totals), the order-id format, and checkout validation. It mirrors the
 * browser's app.js semantics exactly so the page and any agent agree on totals.
 *
 * Menu data is read from the canonical menu.json, so editing the menu needs no
 * code changes here. A cart is a plain object: { [itemId]: qty }.
 */
"use strict";

const menuData = require("../menu.json");

const itemsById = new Map();
for (const m of menuData.menus) for (const it of m.items) itemsById.set(it.id, it);

function getMenu() {
  return {
    currency: menuData.currency,
    deliveryFeeCents: menuData.deliveryFeeCents,
    menus: menuData.menus,
  };
}

function hasItem(id) {
  return itemsById.has(id);
}

function cartSize(cart) {
  return Object.keys(cart).length;
}

function subtotalCents(cart) {
  let total = 0;
  for (const id of Object.keys(cart)) {
    const it = itemsById.get(id);
    if (it) total += it.priceCents * cart[id];
  }
  return total;
}

function deliveryFeeCents(cart) {
  return cartSize(cart) === 0 ? 0 : menuData.deliveryFeeCents;
}

function totalCents(cart) {
  return subtotalCents(cart) + deliveryFeeCents(cart);
}

function itemCount(cart) {
  let n = 0;
  for (const id of Object.keys(cart)) n += cart[id];
  return n;
}

function cartSnapshot(cart) {
  return Object.keys(cart).map((id) => {
    const it = itemsById.get(id);
    return {
      id,
      name: it ? it.name : id,
      qty: cart[id],
      priceCents: it ? it.priceCents : 0,
      lineTotalCents: (it ? it.priceCents : 0) * cart[id],
    };
  });
}

/** Build the public state object from a stored cart row. */
function computeState(row) {
  const cart = row.cart || {};
  return {
    cartId: row.id,
    view: row.view || "menus",
    cart: cartSnapshot(cart),
    itemCount: itemCount(cart),
    subtotalCents: subtotalCents(cart),
    deliveryFeeCents: deliveryFeeCents(cart),
    totalCents: totalCents(cart),
    lastOrder: row.last_order || row.lastOrder || null,
  };
}

// ---- Mutations (operate in place on a plain cart object) -------------------

function addItem(cart, itemId, qty) {
  if (!itemsById.has(itemId)) throw new Error("Unknown itemId: " + itemId);
  const add = qty == null ? 1 : Math.max(1, Math.floor(qty));
  cart[itemId] = (cart[itemId] || 0) + add;
  return cart;
}

function removeItem(cart, itemId) {
  const q = cart[itemId] || 0;
  if (q <= 1) delete cart[itemId];
  else cart[itemId] = q - 1;
  return cart;
}

function setQuantity(cart, itemId, qty) {
  if (!itemsById.has(itemId)) throw new Error("Unknown itemId: " + itemId);
  const n = Math.max(0, Math.floor(qty));
  if (n === 0) delete cart[itemId];
  else cart[itemId] = n;
  return cart;
}

function clearCart(cart) {
  for (const k of Object.keys(cart)) delete cart[k];
  return cart;
}

/** Validate + build a receipt. Throws if the cart is empty or fields missing. */
function buildOrder(cart, details) {
  if (cartSize(cart) === 0) throw new Error("Cart is empty");
  const name = (details.name || "").trim();
  const address = (details.address || "").trim();
  const card = (details.card || "").trim();
  if (!name || !address || !card) {
    throw new Error("Missing delivery details (name, address, card all required)");
  }
  const orderId = "AM-" + (Math.floor(Math.random() * 900000) + 100000);
  return {
    orderId,
    name,
    address,
    items: cartSnapshot(cart),
    subtotalCents: subtotalCents(cart),
    deliveryFeeCents: deliveryFeeCents(cart),
    totalCents: totalCents(cart),
    placedAt: new Date().toISOString(),
  };
}

module.exports = {
  getMenu,
  hasItem,
  computeState,
  addItem,
  removeItem,
  setQuantity,
  clearCart,
  buildOrder,
};
