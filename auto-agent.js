/**
 * Agent Menu — in-browser auto-agent (demo driver).
 *
 * This is the "watch an AI agent order" demo. It drives the *same* server-side
 * cart the page renders, using the public `window.AgentMenu` API, so every
 * action it takes shows up live on the page (and on anyone else watching the
 * same cart). It loops forever, picking randomized, human-paced actions:
 *
 *   add an item  →  remove an item  →  ... →  go to checkout  →  pay  →
 *   start a new order  →  (repeat)
 *
 * It is **opt-in** so it never surprises a real human placing an order:
 *   - Auto-starts when the URL has `?demo=1` (or `?auto=1`).
 *   - Otherwise it waits for the "Run agent demo" button (injected below).
 *
 * Nothing here is privileged — it only calls the same AgentMenu methods an
 * external agent would call over HTTP. It is purely a presentation layer.
 */
(function () {
  "use strict";

  // ---- Tunables ------------------------------------------------------------

  const CFG = {
    minDelayMs: 1050, // pause between actions (randomized up to maxDelayMs)
    maxDelayMs: 2400,
    payPauseMs: 825, // extra "thinking" beat before paying / after confirming
    logLimit: 7, // how many recent lines to keep in the on-screen console
  };

  // Dummy delivery details the agent "types" at checkout (payment is simulated).
  const PERSONAS = [
    { name: "Ada Lovelace", address: "123 Main St, Apt 4, San Francisco, CA 94105", card: "4242 4242 4242 4242" },
    { name: "Alan Turing", address: "78 Bletchley Way, Milton Keynes" , card: "4111 1111 1111 1111" },
    { name: "Grace Hopper", address: "200 Navy Yard Blvd, Washington, DC", card: "5555 5555 5555 4444" },
    { name: "Katherine Johnson", address: "1 Langley Rd, Hampton, VA", card: "4000 0566 5566 5556" },
  ];

  // ---- State ---------------------------------------------------------------

  let running = false;
  let timer = null;
  let menuItems = []; // flat [{id, name, priceCents}, ...]

  // ---- Small utils ---------------------------------------------------------

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const pick = (arr) => arr[rand(0, arr.length - 1)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function flatItems() {
    const menu = window.AgentMenu.getMenu();
    const out = [];
    menu.menus.forEach((m) => m.items.forEach((it) => out.push(it)));
    return out;
  }

  // ---- On-screen "agent activity" console ----------------------------------

  function buildConsole() {
    if (document.getElementById("agent-console")) return;

    // Collapsed by default to a small launcher pill so it never blocks the menu.
    const panel = document.createElement("aside");
    panel.id = "agent-console";
    panel.className = "agent-console is-collapsed";
    panel.setAttribute("data-testid", "agent-console");
    panel.innerHTML =
      '<button type="button" class="agent-launcher" id="agent-launcher" data-testid="agent-launcher" ' +
      'aria-label="Open agent demo">' +
      '<span class="agent-bot" aria-hidden="true">🤖</span>' +
      '<span class="agent-launcher-label">Agent demo</span>' +
      "</button>" +
      '<div class="agent-panel">' +
      '<div class="agent-console-head">' +
      '<span class="agent-console-title"><span class="agent-bot" aria-hidden="true">🤖</span> Agent activity</span>' +
      '<div class="agent-head-controls">' +
      '<button type="button" class="agent-toggle" id="agent-toggle" data-testid="agent-toggle">Run</button>' +
      '<button type="button" class="agent-min" id="agent-min" data-testid="agent-min" aria-label="Minimize">–</button>' +
      "</div>" +
      "</div>" +
      '<ul class="agent-log" id="agent-log" data-testid="agent-log"></ul>' +
      '<p class="agent-hint">A simulated AI agent ordering against this live cart.</p>' +
      "</div>";
    document.body.appendChild(panel);

    document.getElementById("agent-toggle").addEventListener("click", toggle);
    document.getElementById("agent-launcher").addEventListener("click", () => setCollapsed(false));
    document.getElementById("agent-min").addEventListener("click", () => setCollapsed(true));
  }

  function setCollapsed(collapsed) {
    const panel = document.getElementById("agent-console");
    if (panel) panel.classList.toggle("is-collapsed", collapsed);
  }

  function log(message, kind) {
    const list = document.getElementById("agent-log");
    if (!list) return;
    const li = document.createElement("li");
    li.className = "agent-log-line" + (kind ? " agent-log-" + kind : "");
    const time = new Date().toLocaleTimeString([], { hour12: false });
    li.innerHTML = '<span class="agent-log-time">' + time + "</span> " + message;
    list.appendChild(li);
    while (list.children.length > CFG.logLimit) list.removeChild(list.firstChild);
    // Mirror to the ARIA status region the app already exposes for agents.
    const status = document.getElementById("app-status");
    if (status) status.textContent = li.textContent;
  }

  function setRunningUi(on) {
    const btn = document.getElementById("agent-toggle");
    if (btn) {
      btn.textContent = on ? "Stop" : "Run";
      btn.classList.toggle("is-running", on);
    }
    const label = document.querySelector(".agent-launcher-label");
    if (label) label.textContent = on ? "Agent running" : "Agent demo";
    const panel = document.getElementById("agent-console");
    if (panel) panel.classList.toggle("is-running", on);
  }

  // ---- The order routine ---------------------------------------------------

  // Every order runs the same fixed routine (items chosen at random):
  //   scroll down → scroll up → add 1 item → remove that item →
  //   add 3 items → checkout & pay → (repeat)
  // Steps are queued and run one per tick so the pacing stays human.
  let plan = [];

  function buildPlan() {
    const first = pick(menuItems);
    return [
      resetOrder, // clear out and return to the menu for a clean start
      () => scrollMenu("down"),
      () => scrollMenu("up"),
      () => addItem(first), // add 1 item
      () => removeItem(first), // remove that item
      () => addItem(pick(menuItems)), // add 3 items
      () => addItem(pick(menuItems)),
      () => addItem(pick(menuItems)),
      checkoutAndPay, // complete checkout + payment
    ];
  }

  async function runNext() {
    if (plan.length === 0) plan = buildPlan();
    const action = plan.shift();
    await action();
  }

  // ---- Routine steps -------------------------------------------------------

  async function resetOrder() {
    log("Starting a new order…");
    await window.AgentMenu.startNewOrder();
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  async function scrollMenu(dir) {
    const doc = document.documentElement;
    const max = Math.max(0, doc.scrollHeight - window.innerHeight);
    const target = dir === "down" ? max : 0;
    log("Scrolling " + dir + " the menu…");
    window.scrollTo({ top: target, behavior: "smooth" });
    await wait(650); // let the smooth scroll settle before the next step
  }

  async function addItem(item) {
    log("Adding <strong>" + escape(item.name) + "</strong> to cart", "add");
    await window.AgentMenu.addItem(item.id, 1);
  }

  async function removeItem(item) {
    log("Removing <strong>" + escape(item.name) + "</strong> from cart", "remove");
    await window.AgentMenu.removeItem(item.id);
  }

  async function checkoutAndPay() {
    const state = await window.AgentMenu.getState();
    const persona = pick(PERSONAS);
    log("Cart looks good (" + state.itemCount + " item" + (state.itemCount === 1 ? "" : "s") +
      ", " + money(state.totalCents) + "). Heading to checkout…");
    await window.AgentMenu.goToCheckout();
    await wait(CFG.payPauseMs);
    log("Filling delivery details for <strong>" + escape(persona.name) + "</strong> and paying…");
    const receipt = await window.AgentMenu.placeOrder(persona);
    log("Order " + (receipt ? "<strong>" + escape(receipt.orderId) + "</strong>" : "") + " confirmed. 🎉", "pay");
    await wait(CFG.payPauseMs); // let the confirmation show before the next order
  }

  // ---- Loop control --------------------------------------------------------

  async function tick() {
    if (!running) return;
    try {
      await runNext();
    } catch (e) {
      log("⚠️ " + escape((e && e.message) || String(e)), "error");
    }
    if (!running) return;
    timer = setTimeout(tick, rand(CFG.minDelayMs, CFG.maxDelayMs));
  }

  function start() {
    if (running) return;
    running = true;
    plan = []; // start each run from the top of a fresh order routine
    setRunningUi(true);
    log("Agent started — browsing the menu…");
    timer = setTimeout(tick, 600);
  }

  function stop() {
    running = false;
    if (timer) clearTimeout(timer);
    timer = null;
    setRunningUi(false);
    log("Agent stopped.");
  }

  function toggle() {
    running ? stop() : start();
  }

  // ---- Helpers -------------------------------------------------------------

  function money(cents) {
    return "$" + (cents / 100).toFixed(2);
  }
  function escape(str) {
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Boot ----------------------------------------------------------------

  function whenReady(cb) {
    if (document.body && document.body.getAttribute("data-agent-menu-ready") === "true" && window.AgentMenu) {
      return cb();
    }
    const iv = setInterval(() => {
      if (window.AgentMenu && document.body.getAttribute("data-agent-menu-ready") === "true") {
        clearInterval(iv);
        cb();
      }
    }, 150);
  }

  function init() {
    buildConsole();
    whenReady(() => {
      menuItems = flatItems();
      const params = new URLSearchParams(location.search);
      if (params.has("demo") || params.has("auto")) {
        setCollapsed(false); // expand so the narrated activity is visible
        start();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose minimal controls for anyone who wants to drive the demo from code.
  window.AgentDemo = { start, stop, toggle, isRunning: () => running };
})();
