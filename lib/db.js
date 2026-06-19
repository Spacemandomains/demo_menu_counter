/**
 * Agent Menu — cart persistence on Neon (serverless Postgres).
 *
 * Carts live server-side so the storefront page AND any external agent see the
 * same cart: the agent mutates it over HTTP, the browser polls it and renders
 * the changes live. State that only lived in one browser tab could never do
 * that.
 *
 * Connection string comes from the Neon/Vercel integration env (DATABASE_URL).
 * The schema is created on first use, so there is no separate migration step.
 */
"use strict";

const { neon } = require("@neondatabase/serverless");

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING;

let _sql = null;
function db() {
  if (!CONN) {
    throw new Error(
      "No database connection string. Connect the Neon integration to this " +
        "Vercel project so DATABASE_URL is set (Project → Storage / Integrations).",
    );
  }
  if (!_sql) _sql = neon(CONN);
  return _sql;
}

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  const sql = db();
  await sql`
    CREATE TABLE IF NOT EXISTS carts (
      id          text PRIMARY KEY,
      cart        jsonb NOT NULL DEFAULT '{}'::jsonb,
      view        text  NOT NULL DEFAULT 'menus',
      last_order  jsonb,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now()
    )`;
  schemaReady = true;
}

function newId() {
  return (
    "cart_" +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}

async function createCart() {
  await ensureSchema();
  const sql = db();
  const id = newId();
  await sql`INSERT INTO carts (id) VALUES (${id})`;
  return { id, cart: {}, view: "menus", last_order: null };
}

/** Only allow simple, safe cart ids when a caller picks one (e.g. "demo"). */
function safeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null;
}

/** Get a cart by id, creating it if it doesn't exist yet (idempotent). */
async function getOrCreateCart(id) {
  await ensureSchema();
  const sql = db();
  await sql`INSERT INTO carts (id) VALUES (${id}) ON CONFLICT (id) DO NOTHING`;
  const rows = await sql`SELECT id, cart, view, last_order FROM carts WHERE id = ${id}`;
  return rows[0];
}

async function getCart(id) {
  await ensureSchema();
  const sql = db();
  const rows = await sql`SELECT id, cart, view, last_order FROM carts WHERE id = ${id}`;
  return rows[0] || null;
}

async function saveCart(id, { cart, view, lastOrder }) {
  await ensureSchema();
  const sql = db();
  await sql`
    UPDATE carts
       SET cart = ${JSON.stringify(cart)}::jsonb,
           view = ${view},
           last_order = ${lastOrder ? JSON.stringify(lastOrder) : null}::jsonb,
           updated_at = now()
     WHERE id = ${id}`;
}

module.exports = { createCart, getOrCreateCart, getCart, saveCart, safeId, hasDb: () => !!CONN };
