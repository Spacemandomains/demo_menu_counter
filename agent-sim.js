#!/usr/bin/env node
/**
 * Agent Menu — standalone agent simulator (external driver).
 *
 * Drives the live HTTP API exactly as an external AI agent would: discover the
 * menu, fill a server-side cart with randomized add/remove actions, then check
 * out and pay (simulated). Open the page at the same cart id in a browser and
 * you'll watch the cart fill, flip to checkout, and confirm — in real time.
 *
 * Usage:
 *   node agent-sim.js [baseUrl] [--cart=demo] [--rounds=N] [--once] [--fast]
 *
 *   baseUrl   Base URL of the running app. Default: env BASE_URL or
 *             http://localhost:3000
 *   --cart    Cart id to drive (must match what the browser watches).
 *             Default: "demo" (the shared cart the page binds to).
 *   --rounds  Number of complete order cycles before exiting. Default: Infinity.
 *   --once    Shorthand for --rounds=1.
 *   --fast    Shorter pauses between actions.
 *
 * Examples:
 *   node agent-sim.js                       # drive local dev's "demo" cart forever
 *   node agent-sim.js https://your.app      # drive a deployed instance
 *   node agent-sim.js --once                # place exactly one order and stop
 *
 * Requires Node 18+ (global fetch).
 */
"use strict";

// ---- Args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = {};
let baseUrl = process.env.BASE_URL || "http://localhost:3000";
for (const a of argv) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    flags[k] = v === undefined ? true : v;
  } else {
    baseUrl = a;
  }
}
baseUrl = baseUrl.replace(/\/+$/, "");

const CART_ID = flags.cart || "demo";
const ROUNDS = flags.once ? 1 : flags.rounds ? parseInt(flags.rounds, 10) : Infinity;
const FAST = !!flags.fast;
const DELAY = FAST ? [400, 1100] : [700, 1600];
const PAY_PAUSE = FAST ? 500 : 550;

const PERSONAS = [
  { name: "Ada Lovelace", address: "123 Main St, Apt 4, San Francisco, CA 94105", card: "4242 4242 4242 4242" },
  { name: "Alan Turing", address: "78 Bletchley Way, Milton Keynes", card: "4111 1111 1111 1111" },
  { name: "Grace Hopper", address: "200 Navy Yard Blvd, Washington, DC", card: "5555 5555 5555 4444" },
  { name: "Katherine Johnson", address: "1 Langley Rd, Hampton, VA", card: "4000 0566 5566 5556" },
];

// ---- Utils -----------------------------------------------------------------

const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[rand(0, arr.length - 1)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const money = (c) => "$" + (c / 100).toFixed(2);

function stamp() {
  return new Date().toLocaleTimeString([], { hour12: false });
}
function log(msg) {
  console.log(`\x1b[90m${stamp()}\x1b[0m 🤖 ${msg}`);
}

async function api(path, opts) {
  const res = await fetch(baseUrl + path, opts);
  let body = {};
  try {
    body = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error((body && body.error) || "HTTP " + res.status);
  return body;
}
const postJson = (path, payload) =>
  api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

// ---- Discovery -------------------------------------------------------------

async function loadMenu() {
  const menu = await api("/menu.json");
  const items = [];
  menu.menus.forEach((m) => m.items.forEach((it) => items.push(it)));
  return items;
}

async function ensureCart() {
  const state = await postJson("/api/cart", { cartId: CART_ID });
  return state;
}
const getState = () => api("/api/cart?id=" + encodeURIComponent(CART_ID));

// ---- Actions ---------------------------------------------------------------

let MENU_ITEMS = [];

async function resetOrder() {
  log("Starting a new order…");
  await postJson("/api/cart-items", { cartId: CART_ID, action: "clear" });
  await postJson("/api/cart-items", { cartId: CART_ID, action: "setview", view: "menus" });
}

async function addOne(item) {
  log(`Adding ${item.name} (${money(item.priceCents)})`);
  return postJson("/api/cart-items", { cartId: CART_ID, action: "add", itemId: item.id, qty: 1 });
}

async function removeOne(item) {
  log(`Removing ${item.name}`);
  return postJson("/api/cart-items", { cartId: CART_ID, action: "remove", itemId: item.id });
}

async function checkoutAndPay() {
  const state = await getState();
  const persona = pick(PERSONAS);
  log(`Cart looks good (${state.itemCount} item(s), ${money(state.totalCents)}). Heading to checkout…`);
  await postJson("/api/cart-items", { cartId: CART_ID, action: "setview", view: "checkout" });
  await wait(PAY_PAUSE);
  log(`Paying as ${persona.name}…`);
  const out = await postJson("/api/checkout", { cartId: CART_ID, ...persona });
  log(`Order \x1b[1m${out.receipt.orderId}\x1b[0m confirmed — paid ${money(out.receipt.totalCents)}. 🎉`);
  return out;
}

// Fixed per-order routine (items chosen at random; no scrolling in a terminal):
//   add 1 item → remove that item → add 3 items → checkout & pay → (repeat)
let plan = [];
function buildPlan() {
  const first = pick(MENU_ITEMS);
  return [
    { fn: resetOrder },
    { fn: () => addOne(first) }, // add 1 item
    { fn: () => removeOne(first) }, // remove that item
    { fn: () => addOne(pick(MENU_ITEMS)) }, // add 3 items
    { fn: () => addOne(pick(MENU_ITEMS)) },
    { fn: () => addOne(pick(MENU_ITEMS)) },
    { fn: checkoutAndPay, order: true }, // complete checkout + payment
  ];
}

// Run the next step in the routine. Returns true once an order was placed.
async function step() {
  if (plan.length === 0) plan = buildPlan();
  const s = plan.shift();
  await s.fn();
  return !!s.order;
}

// ---- Main ------------------------------------------------------------------

async function main() {
  log(`Connecting to ${baseUrl} (cart "${CART_ID}")…`);
  MENU_ITEMS = await loadMenu();
  await ensureCart();
  log(`Discovered ${MENU_ITEMS.length} items. Watch live at ${baseUrl}/?cart=${CART_ID}`);

  let placed = 0;
  let stop = false;
  process.on("SIGINT", () => {
    console.log();
    log("Caught Ctrl-C — stopping after this action.");
    stop = true;
  });

  while (!stop && placed < ROUNDS) {
    const didOrder = await step();
    if (didOrder) placed++;
    if (stop || placed >= ROUNDS) break;
    await wait(rand(DELAY[0], DELAY[1]));
  }

  log(`Done — placed ${placed} order(s).`);
  process.exit(0);
}

main().catch((e) => {
  console.error(`\x1b[31mAgent simulator failed:\x1b[0m ${(e && e.message) || e}`);
  console.error(`(Is the app running at ${baseUrl}? Try: node agent-sim.js <baseUrl>)`);
  process.exit(1);
});
