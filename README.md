# Agent Menu — Dummy Menu Prototype

A small ordering prototype built so an **AI agent** can demo a full purchase
flow: browse menus → add items to a cart → fill in checkout details → pay
(simulated) → see an order confirmation.

The cart is **server-side** (persisted in Neon Postgres) and addressed by a
`cartId` kept in the page URL (`?cart=...`). That's the whole point: the cart an
agent fills over HTTP is the *same* cart a human watches fill live in the
browser. The page polls the cart API ~1×/second, so when an agent transacts
against your `cartId`, you watch items appear, the view flip to checkout, and the
order confirm — in real time.

## Run it

This now has serverless functions and a database, so run it with the Vercel CLI:

```bash
npm install
# Provide a Neon connection string (Vercel injects this in production):
export DATABASE_URL="postgres://...neon.tech/...?sslmode=require"
vercel dev
# then open the printed localhost URL
```

The static UI alone still opens, but the cart needs the API + `DATABASE_URL` to
work. On Vercel, connect the **Neon integration** to the project so
`DATABASE_URL` is set; the `carts` table is created automatically on first use.

## Watch an agent order (auto-demo)

To show *how Agent Menu works*, the cart can drive itself — randomly adding,
removing, and placing simulated orders, exactly as an AI agent would. Because
the cart is server-side, you just watch it happen live on the page.

Two ways to run it:

### In the browser (zero setup)

`auto-agent.js` ships with the page. It only uses the public `window.AgentMenu`
API, so every move shows up live in the UI. It is **opt-in** so it never hijacks
a real human's order:

- Open the page with **`?demo=1`** (or `?auto=1`) to auto-start, **or**
- Click **Run agent demo** in the floating "🤖 Agent activity" console (bottom-right).

The console narrates each action ("Adding Crispy Fries", "Heading to
checkout…", "Order AM-… confirmed 🎉") and loops forever until you click
**Stop agent**. You can also drive it from code: `AgentDemo.start()` /
`AgentDemo.stop()` / `AgentDemo.toggle()`.

### As an external agent (Node script)

`agent-sim.js` drives the *same* HTTP API from a separate process — the most
faithful "an AI agent is transacting against your cart" demo. Open the page,
then in another terminal:

```bash
npm run demo                       # drive local dev's shared "demo" cart, forever
npm run demo:once                  # place exactly one order and stop
node agent-sim.js https://your.app # drive a deployed instance
node agent-sim.js --cart=demo --rounds=3 --fast
```

Open `<url>/?cart=demo` in a browser and watch the cart fill, flip to checkout,
and confirm in real time. Requires Node 18+ (global `fetch`); no DB access
needed — it only speaks the public API.

## The flow

1. **Menus** (`#view-menus`) — 3 dummy menus with 1–2 items each.
   Click **Add to cart** on any item.
2. **Checkout** (`#view-checkout`) — open the cart (top-right button), adjust
   quantities, enter name / address / card, then **Pay & place order**.
3. **Confirmation** (`#view-confirmation`) — a receipt with an order number.
   The cart resets so the demo can be run again.

## Files

| File           | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| File                              | Purpose                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| `index.html`                      | Markup for the three views.                                 |
| `styles.css`                      | Styling.                                                    |
| `menu-data.js`                    | The dummy menu data the page renders (edit to change menu). |
| `menu.json`                       | Same menu as fetchable JSON (server's source of truth).     |
| `app.js`                          | Renders the server cart and polls it live.                  |
| `auto-agent.js`                   | In-browser auto-demo agent (opt-in; randomized ordering).   |
| `agent-sim.js`                    | Standalone Node script that drives the API as an agent.     |
| `.well-known/agent-menu.json`     | Discovery manifest advertising the menu + cart API.         |
| `api/cart.js`                     | Create a cart (`POST`) / read a cart (`GET ?id=`).          |
| `api/cart-items.js`               | Add / remove / set qty / clear / set view.                  |
| `api/checkout.js`                 | Place the order (simulated pay) → receipt.                  |
| `lib/store.js`                    | Cart math + validation (server source of truth).            |
| `lib/db.js`                       | Neon persistence (`carts` table, auto-migrated).            |

## How an agent transacts (production model)

Any agent — not just the bundled demo — can complete a purchase over HTTP. The
flow is fully self-describing:

1. **Discover** the API from the manifest: `GET /.well-known/agent-menu.json`.
2. **Discover** the menu: `GET /menu.json`.
3. **Create a cart**: `POST /api/cart` → `{ cartId, ... }`.
4. **Fill it**: `POST /api/cart-items` `{ cartId, action: "add", itemId, qty }`
   (also `remove`, `setqty`, `clear`, `setview`).
5. **Pay**: `POST /api/checkout` `{ cartId, name, address, card }` → `{ receipt }`.

All endpoints are CORS-enabled (`Access-Control-Allow-Origin: *`) and the cart is
server-side, so a human can watch that same `cartId` fill live at
`/?cart=<cartId>`. Prices are integer cents; a flat delivery fee is added once
the cart is non-empty; payment is simulated (any card value works).

```bash
CART=$(curl -s -XPOST $URL/api/cart | jq -r .cartId)
curl -s -XPOST $URL/api/cart-items -d "{\"cartId\":\"$CART\",\"action\":\"add\",\"itemId\":\"bb-classic\",\"qty\":2}"
curl -s -XPOST $URL/api/checkout   -d "{\"cartId\":\"$CART\",\"name\":\"Ada\",\"address\":\"123 Main\",\"card\":\"4242\"}"
# open $URL/?cart=$CART in a browser to watch it
```

## Structured data for agents

If your agent would rather read structured data than scrape the DOM, there are
two options.

### 1. Static menu — `menu.json`

Fetchable JSON describing the menus, items, prices (in cents), and the delivery
fee. Good for the agent to plan an order before touching the page:

```js
const menu = await fetch("/menu.json").then((r) => r.json());
```

### 2. Live API — `window.AgentMenu`

Once the page loads, `app.js` exposes a programmatic API on `window.AgentMenu`
so an in-browser agent can drive the whole flow without clicking. It is now
backed by the server cart, so the mutating methods (`addItem`, `removeItem`,
`setQuantity`, `clearCart`, `goToCheckout`, `placeOrder`, `startNewOrder`) and
`getState()` are **async** (they `await` the cart API). Readiness is signalled by
`document.body[data-agent-menu-ready="true"]`, and the current cart id is
available via `AgentMenu.getCartId()`.

Every method returns the current state object, shaped like:

```jsonc
{
  "view": "checkout",                 // "menus" | "checkout" | "confirmation"
  "cart": [
    { "id": "bb-classic", "name": "Classic Cheeseburger",
      "qty": 2, "priceCents": 899, "lineTotalCents": 1798 }
  ],
  "itemCount": 2,
  "subtotalCents": 1798,
  "deliveryFeeCents": 299,
  "totalCents": 2097,
  "lastOrder": null                   // populated after placeOrder()
}
```

**Methods**

| Method | Description |
| ------ | ----------- |
| `getMenu()` | Full menu (same shape as `menu.json`). |
| `getItem(itemId)` | One item, or `null`. |
| `getState()` | Current state object (above). |
| `getCart()` | Just the cart line array. |
| `getLastOrder()` | The last placed order receipt, or `null`. |
| `addItem(itemId, qty=1)` | Add to cart. |
| `removeItem(itemId)` | Remove one of an item. |
| `setQuantity(itemId, qty)` | Set exact qty (`0` removes). |
| `clearCart()` | Empty the cart. |
| `goToMenus()` / `goToCheckout()` | Switch view. |
| `setDeliveryDetails({name, address, card})` | Fill the form. |
| `placeOrder({name, address, card})` | Pay & place order; returns the receipt. |
| `startNewOrder()` | Reset for another run. |

A full order in one shot (note the `await`s — these hit the server cart):

```js
await AgentMenu.addItem("bb-classic", 2);
await AgentMenu.addItem("dc-latte");
const receipt = await AgentMenu.placeOrder({
  name: "Ada Lovelace",
  address: "123 Main St, Apt 4",
  card: "4242 4242 4242 4242",
});
// receipt.orderId, receipt.totalCents, receipt.items, ...
```

`placeOrder` throws if the cart is empty or any delivery field is missing.

## Built for agents

Everything an agent needs to interact with is exposed via stable
`data-testid` attributes, so selectors don't depend on layout or copy:

- Items: `add-<itemId>` to add (e.g. `add-bb-classic`), `price-<itemId>`.
- Open the cart: `open-cart`; item count: `cart-count`.
- Cart lines: `cart-line-<itemId>`, `increment-<itemId>`,
  `decrement-<itemId>`, `qty-<itemId>`, `line-total-<itemId>`.
- Summary: `summary-subtotal`, `summary-fee`, `summary-total`.
- Form fields: `field-name`, `field-address`, `field-card`.
- Place the order: `place-order`.
- Receipt: `receipt-order-id`, `receipt-name`, `receipt-items`,
  `receipt-total`.

There's also an ARIA live region (`data-testid="app-status"`) that narrates the
current state ("Added Classic Cheeseburger to cart", "Order AM-123456
confirmed…"), which an agent can read to confirm each step succeeded.

### Item IDs

| Menu             | Item                 | `itemId`         | Price  |
| ---------------- | -------------------- | ---------------- | ------ |
| Burger Barn      | Classic Cheeseburger | `bb-classic`     | $8.99  |
| Burger Barn      | Crispy Fries         | `bb-fries`       | $3.99  |
| Pizza Piazza     | Margherita Pizza     | `pp-margherita`  | $10.99 |
| Pizza Piazza     | Pepperoni Pizza      | `pp-pepperoni`   | $12.49 |
| Drip Coffee Co.  | Oat Milk Latte       | `dc-latte`       | $5.49  |

A flat $2.99 delivery fee is added at checkout.
