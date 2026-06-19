/**
 * Agent Menu — dummy menu data.
 *
 * This is intentionally small (a few menus, 1–2 items each) so an AI agent
 * has a clean, predictable surface to demo ordering against.
 *
 * Each item has a stable `id` that agents can rely on. Prices are in whole
 * cents to avoid floating-point rounding issues during checkout math.
 */
window.AGENT_MENU_DATA = {
  // Flat delivery fee applied at checkout, in cents.
  deliveryFeeCents: 299,

  menus: [
    {
      id: "burger-barn",
      name: "Burger Barn",
      description: "Classic smash burgers and sides.",
      items: [
        {
          id: "bb-classic",
          name: "Classic Cheeseburger",
          description: "Beef patty, cheddar, lettuce, tomato, house sauce.",
          priceCents: 899,
        },
        {
          id: "bb-fries",
          name: "Crispy Fries",
          description: "Hand-cut, sea salt.",
          priceCents: 399,
        },
      ],
    },
    {
      id: "pizza-piazza",
      name: "Pizza Piazza",
      description: "Wood-fired personal pizzas.",
      items: [
        {
          id: "pp-margherita",
          name: "Margherita Pizza",
          description: "Tomato, fresh mozzarella, basil.",
          priceCents: 1099,
        },
        {
          id: "pp-pepperoni",
          name: "Pepperoni Pizza",
          description: "Tomato, mozzarella, pepperoni.",
          priceCents: 1249,
        },
      ],
    },
    {
      id: "drip-coffee",
      name: "Drip Coffee Co.",
      description: "Coffee and cold drinks.",
      items: [
        {
          id: "dc-latte",
          name: "Oat Milk Latte",
          description: "Double shot, oat milk.",
          priceCents: 549,
        },
      ],
    },
  ],
};
