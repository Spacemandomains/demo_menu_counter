/**
 * Agent Menu — storefront UI, backed by a server-side (Neon) cart.
 *
 * The important change from a toy demo: the cart does NOT live in this browser
 * tab. It lives on the server, addressed by a `cartId` (kept in the URL as
 * `?cart=...`). This page is just one *view* of that cart:
 *
 *   - Your clicks call the cart API (/api/cart-items, /api/checkout).
 *   - A poll loop (~1/sec) re-reads /api/cart and re-renders, so when an AI
 *     agent transacts against the same cartId over HTTP, you watch the items
 *     appear, the view flip to checkout, and the order confirm — live.
 *
 * `window.AgentMenu` is preserved (now async) so an in-browser agent can drive
 * the same server cart without scraping the DOM.
 */
(function () {
  "use strict";

  const data = window.AGENT_MENU_DATA;

  // Flat lookup of every item by id, built from the menu data (used for the
  // static menu rendering only — cart math is authoritative on the server).
  const itemsById = new Map();
  data.menus.forEach((menu) => menu.items.forEach((item) => itemsById.set(item.id, item)));

  // ---- Live cart wiring ----------------------------------------------------

  let cartId = null;
  let state = null; // latest server state
  let currentView = "menus"; // what this tab is showing
  let lastServerView = "menus"; // to detect agent-driven view changes
  let mutating = false; // suppress polling while our own write is in flight
  const POLL_MS = 1200;

  // A single, reusable cart shared by this page and any agent, so reloading or
  // re-running the agent always lands on the same cart (override with ?cart=).
  const DEFAULT_CART_ID = "demo";

  // Dummy delivery details so the human can check out (or watch the agent) with
  // no typing. Edit freely — payment is simulated.
  const DUMMY_DETAILS = {
    name: "Ada Lovelace",
    address: "123 Main St, Apt 4, San Francisco, CA 94105",
    card: "4242 4242 4242 4242",
  };

  async function api(path, opts) {
    const res = await fetch(path, opts);
    let body = {};
    try {
      body = await res.json();
    } catch (_) {}
    if (!res.ok) throw new Error(body && body.error ? body.error : "HTTP " + res.status);
    return body;
  }

  function postJson(path, payload) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function ensureCart() {
    // Always bind to the single shared cart so this page can never drift to a
    // different cart than the agent (which also uses the default cart). This is
    // get-or-create, so the cart and its contents persist across reloads.
    const s = await postJson("/api/cart", { cartId: DEFAULT_CART_ID });
    cartId = s.cartId;
    // Strip any stale ?cart=... from the URL to avoid pinning to an old cart.
    if (location.search) history.replaceState(null, "", location.pathname);
    return s;
  }

  // ---- Helpers -------------------------------------------------------------

  function formatPrice(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function setStatus(text) {
    const el = document.getElementById("app-status");
    if (el) el.textContent = text;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ---- View switching ------------------------------------------------------

  function showView(name) {
    currentView = name;
    document.querySelectorAll(".view").forEach((view) => {
      view.hidden = view.dataset.view !== name;
    });
    window.scrollTo(0, 0);
  }

  // ---- Live banner ---------------------------------------------------------

  function renderBanner() {
    let el = document.getElementById("live-banner");
    if (!el) {
      el = document.createElement("div");
      el.id = "live-banner";
      el.className = "live-banner";
      el.setAttribute("data-testid", "live-banner");
      const app = document.getElementById("app");
      app.parentNode.insertBefore(el, app);
    }
    el.innerHTML =
      '<span class="live-dot" aria-hidden="true"></span>' +
      '<span class="live-text">Live — this cart updates in real time as an agent orders.</span>';
  }

  function prefillDummyDetails() {
    const n = document.getElementById("field-name");
    const a = document.getElementById("field-address");
    const c = document.getElementById("field-card");
    if (n && !n.value) n.value = DUMMY_DETAILS.name;
    if (a && !a.value) a.value = DUMMY_DETAILS.address;
    if (c && !c.value) c.value = DUMMY_DETAILS.card;
  }

  // ---- Rendering: menus (static) -------------------------------------------

  function renderMenus() {
    const container = document.getElementById("menus");
    container.innerHTML = "";

    data.menus.forEach((menu) => {
      const section = document.createElement("section");
      section.className = "menu-card";
      section.dataset.menuId = menu.id;
      section.setAttribute("data-testid", "menu-" + menu.id);

      const heading = document.createElement("div");
      heading.className = "menu-head";
      heading.innerHTML =
        '<h2 class="menu-name">' +
        escapeHtml(menu.name) +
        '</h2><p class="menu-desc">' +
        escapeHtml(menu.description) +
        "</p>";
      section.appendChild(heading);

      const list = document.createElement("ul");
      list.className = "item-list";

      menu.items.forEach((item) => {
        const li = document.createElement("li");
        li.className = "item";
        li.dataset.itemId = item.id;
        li.setAttribute("data-testid", "item-" + item.id);

        li.innerHTML =
          '<div class="item-info">' +
          '<span class="item-name">' + escapeHtml(item.name) + "</span>" +
          '<span class="item-desc">' + escapeHtml(item.description) + "</span>" +
          '<span class="item-price" data-testid="price-' + item.id + '">' +
          formatPrice(item.priceCents) + "</span>" +
          "</div>";

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "add-button";
        addBtn.textContent = "Add to cart";
        addBtn.setAttribute("data-testid", "add-" + item.id);
        addBtn.setAttribute("aria-label", "Add " + item.name + " to cart");
        addBtn.addEventListener("click", () => addToCart(item.id));

        li.appendChild(addBtn);
        list.appendChild(li);
      });

      section.appendChild(list);
      container.appendChild(section);
    });
  }

  // ---- Rendering: cart count, checkout, confirmation -----------------------

  function renderCartCount() {
    const n = state ? state.itemCount : 0;
    document.getElementById("cart-count").textContent = String(n);
  }

  function renderCheckout() {
    const list = document.getElementById("cart-items");
    const empty = document.getElementById("cart-empty");
    list.innerHTML = "";

    const lines = (state && state.cart) || [];
    empty.hidden = lines.length !== 0;
    const clearBtn = document.getElementById("clear-cart");
    if (clearBtn) clearBtn.hidden = lines.length === 0;

    lines.forEach((line) => {
      const li = document.createElement("li");
      li.className = "cart-line";
      li.setAttribute("data-testid", "cart-line-" + line.id);

      const info = document.createElement("div");
      info.className = "cart-line-info";
      info.innerHTML =
        '<span class="cart-line-name">' + escapeHtml(line.name) + "</span>" +
        '<span class="cart-line-price">' + formatPrice(line.priceCents) + " each</span>";

      const controls = document.createElement("div");
      controls.className = "qty-controls";

      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "qty-button";
      minus.textContent = "−";
      minus.setAttribute("data-testid", "decrement-" + line.id);
      minus.setAttribute("aria-label", "Remove one " + line.name);
      minus.addEventListener("click", () => removeFromCart(line.id));

      const count = document.createElement("span");
      count.className = "qty-count";
      count.textContent = String(line.qty);
      count.setAttribute("data-testid", "qty-" + line.id);

      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "qty-button";
      plus.textContent = "+";
      plus.setAttribute("data-testid", "increment-" + line.id);
      plus.setAttribute("aria-label", "Add one more " + line.name);
      plus.addEventListener("click", () => addToCart(line.id));

      controls.appendChild(minus);
      controls.appendChild(count);
      controls.appendChild(plus);

      const lineTotal = document.createElement("span");
      lineTotal.className = "cart-line-total";
      lineTotal.setAttribute("data-testid", "line-total-" + line.id);
      lineTotal.textContent = formatPrice(line.lineTotalCents);

      li.appendChild(info);
      li.appendChild(controls);
      li.appendChild(lineTotal);
      list.appendChild(li);
    });

    document.getElementById("summary-subtotal").textContent = formatPrice(state ? state.subtotalCents : 0);
    document.getElementById("summary-fee").textContent = formatPrice(state ? state.deliveryFeeCents : 0);
    document.getElementById("summary-total").textContent = formatPrice(state ? state.totalCents : 0);
  }

  function renderReceipt(order) {
    if (!order) return;
    const itemSummary = (order.items || []).map((li) => li.qty + "× " + li.name).join(", ");
    document.getElementById("receipt-order-id").textContent = order.orderId;
    document.getElementById("receipt-name").textContent = order.name;
    document.getElementById("receipt-items").textContent = itemSummary;
    document.getElementById("receipt-total").textContent = formatPrice(order.totalCents);
  }

  // ---- Apply server state --------------------------------------------------

  function applyState(next, opts) {
    opts = opts || {};
    state = next;
    renderCartCount();
    if (currentView === "checkout") renderCheckout();
    if (next.lastOrder) renderReceipt(next.lastOrder);

    // Follow agent-driven view changes (menus -> checkout -> confirmation)
    // without yanking the human if the server view hasn't actually changed.
    if (next.view !== lastServerView) {
      lastServerView = next.view;
      if (next.view === "confirmation") {
        renderCheckout();
        renderReceipt(next.lastOrder);
        showView("confirmation");
        setStatus("Order " + (next.lastOrder ? next.lastOrder.orderId : "") + " confirmed.");
      } else if (next.view === "checkout") {
        renderCheckout();
        showView("checkout");
        setStatus("Viewing checkout");
      } else if (next.view === "menus" && !opts.local) {
        showView("menus");
      }
    }
  }

  // ---- Cart mutations (call the API, then apply the returned state) ---------

  async function mutate(payload) {
    mutating = true;
    try {
      const next = await postJson("/api/cart-items", Object.assign({ cartId }, payload));
      applyState(next, { local: true });
    } catch (e) {
      setStatus("Error: " + (e && e.message ? e.message : e));
    } finally {
      mutating = false;
    }
  }

  function addToCart(itemId, qty) {
    const item = itemsById.get(itemId);
    setStatus("Adding " + (item ? item.name : itemId) + " to cart…");
    return mutate({ action: "add", itemId: itemId, qty: qty });
  }
  function removeFromCart(itemId) {
    return mutate({ action: "remove", itemId: itemId });
  }
  function setQuantity(itemId, qty) {
    return mutate({ action: "setqty", itemId: itemId, qty: qty });
  }
  function clearCart() {
    return mutate({ action: "clear" });
  }

  // ---- Checkout ------------------------------------------------------------

  async function submitOrder(details) {
    mutating = true;
    try {
      const out = await postJson("/api/checkout", Object.assign({ cartId }, details));
      applyState(out.state, { local: true });
      renderReceipt(out.receipt);
      showView("confirmation");
      setStatus("Order " + out.receipt.orderId + " confirmed. Total paid " + formatPrice(out.receipt.totalCents));
      lastServerView = "confirmation";
      return out.receipt;
    } finally {
      mutating = false;
    }
  }

  function handlePlaceOrder(event) {
    event.preventDefault();
    if (!state || state.itemCount === 0) {
      setStatus("Cannot place order: cart is empty");
      window.alert("Your cart is empty. Add an item before checking out.");
      return;
    }
    const form = document.getElementById("checkout-form");
    if (!form.reportValidity()) {
      setStatus("Cannot place order: missing delivery details");
      return;
    }
    submitOrder({
      name: document.getElementById("field-name").value,
      address: document.getElementById("field-address").value,
      card: document.getElementById("field-card").value,
    }).catch((e) => {
      setStatus("Error: " + (e && e.message ? e.message : e));
      window.alert("Could not place order: " + (e && e.message ? e.message : e));
    });
  }

  async function startNewOrder() {
    // Reuse the same cart id — just empty it and return to the menus.
    await postJson("/api/cart-items", { cartId, action: "clear" });
    const s = await postJson("/api/cart-items", { cartId, action: "setview", view: "menus" });
    prefillDummyDetails();
    lastServerView = "menus";
    applyState(s, { local: true });
    showView("menus");
  }

  // ---- Poll loop -----------------------------------------------------------

  async function poll() {
    if (!cartId || mutating) return;
    try {
      const next = await api("/api/cart?id=" + encodeURIComponent(cartId));
      applyState(next);
    } catch (_) {
      // Transient errors are fine; the next tick retries.
    }
  }

  // ---- Programmatic API (for in-browser agents) ----------------------------

  function setDeliveryDetails(details) {
    details = details || {};
    if (details.name != null) document.getElementById("field-name").value = details.name;
    if (details.address != null) document.getElementById("field-address").value = details.address;
    if (details.card != null) document.getElementById("field-card").value = details.card;
  }

  const AgentMenu = {
    getMenu: function () {
      return JSON.parse(
        JSON.stringify({ currency: "USD", deliveryFeeCents: data.deliveryFeeCents, menus: data.menus }),
      );
    },
    getItem: function (itemId) {
      const item = itemsById.get(itemId);
      return item ? JSON.parse(JSON.stringify(item)) : null;
    },
    getCartId: function () {
      return cartId;
    },
    getState: async function () {
      return api("/api/cart?id=" + encodeURIComponent(cartId));
    },
    getCart: function () {
      return state ? state.cart.slice() : [];
    },
    getLastOrder: function () {
      return state && state.lastOrder ? JSON.parse(JSON.stringify(state.lastOrder)) : null;
    },
    addItem: async function (itemId, qty) {
      await addToCart(itemId, qty);
      return state;
    },
    removeItem: async function (itemId) {
      await removeFromCart(itemId);
      return state;
    },
    setQuantity: async function (itemId, qty) {
      await setQuantity(itemId, qty);
      return state;
    },
    clearCart: async function () {
      await clearCart();
      return state;
    },
    goToMenus: async function () {
      await mutate({ action: "setview", view: "menus" });
      showView("menus");
      return state;
    },
    goToCheckout: async function () {
      await mutate({ action: "setview", view: "checkout" });
      renderCheckout();
      showView("checkout");
      return state;
    },
    setDeliveryDetails: function (details) {
      setDeliveryDetails(details);
      return state;
    },
    placeOrder: async function (details) {
      if (details) setDeliveryDetails(details);
      return submitOrder({
        name: document.getElementById("field-name").value,
        address: document.getElementById("field-address").value,
        card: document.getElementById("field-card").value,
      });
    },
    startNewOrder: async function () {
      await startNewOrder();
      return state;
    },
  };

  // ---- Wire up -------------------------------------------------------------

  async function init() {
    renderMenus();

    document.getElementById("open-cart").addEventListener("click", () => {
      renderCheckout();
      showView("checkout");
    });
    document.getElementById("back-to-menus").addEventListener("click", () => {
      showView("menus");
    });
    document.getElementById("clear-cart").addEventListener("click", () => {
      clearCart();
    });
    document.getElementById("checkout-form").addEventListener("submit", handlePlaceOrder);
    document.getElementById("new-order").addEventListener("click", () => {
      startNewOrder().catch(() => {});
    });

    prefillDummyDetails();
    showView("menus");

    try {
      const s = await ensureCart();
      lastServerView = s.view || "menus";
      applyState(s, { local: true });
      renderBanner();
      if (s.view === "confirmation") showView("confirmation");
    } catch (e) {
      setStatus("Could not connect to the cart service: " + (e && e.message ? e.message : e));
    }

    setInterval(poll, POLL_MS);

    // Expose the agent API and signal readiness.
    window.AgentMenu = AgentMenu;
    document.body.setAttribute("data-agent-menu-ready", "true");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
