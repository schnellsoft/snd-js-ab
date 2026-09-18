export class Card {
  /**
   * Cache card nodes, nav buttons, and the slide list.
   * @param {HTMLElement} root
   * @param {{
   *   items?: Array<{ title: string, price: string, icon?: string }>,
   *   prevButton?: HTMLButtonElement | null,
   *   nextButton?: HTMLButtonElement | null,
   * }} [options]
   */
  constructor(root, options = {}) {
    this.root = root;
    this.titleEl = root.querySelector(".ct-card-title");
    this.priceEl = root.querySelector(".ct-card-price");
    this.iconEl = root.querySelector(".ct-card-bg");
    this.iconUse = this.iconEl?.querySelector("use") ?? null;
    this.prevButton = options.prevButton ?? document.querySelector(".left-button");
    this.nextButton = options.nextButton ?? document.querySelector(".right-button");
    this.items = options.items ?? Card.#defaultItems();
    this.index = 0;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  /** Bind prev/next controls and paint the current slide. */
  connect() {
    if (!this.root || !this.titleEl || !this.priceEl || !this.items.length) {
      return;
    }

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.prevButton?.addEventListener("click", () => this.prev(), { signal });
    this.nextButton?.addEventListener("click", () => this.next(), { signal });
    document.addEventListener("keydown", (event) => this.#onKey(event), { signal });

    this.root.setAttribute("aria-live", "polite");
    this.#render();
  }

  /** Remove listeners bound by connect(). */
  disconnect() {
    this.controller?.abort();
    this.controller = null;
  }

  prev() {
    this.#go(-1);
  }

  next() {
    this.#go(1);
  }

  /**
   * Replace the slide list and show the first item.
   * @param {Array<{ title: string, price: string, icon?: string }>} items
   */
  setItems(items) {
    this.items = items.length ? items : Card.#defaultItems();
    this.index = 0;
    this.#render();
  }

  /**
   * @param {number} step
   */
  #go(step) {
    const count = this.items.length;
    if (count < 2) {
      return;
    }

    this.index = (this.index + step + count) % count;
    this.#render();
  }

  /**
   * @param {KeyboardEvent} event
   */
  #onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.prev();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.next();
    }
  }

  #render() {
    const item = this.items[this.index];
    if (!item) {
      return;
    }

    this.titleEl.textContent = item.title;
    this.priceEl.textContent = item.price;
    this.#setIcon(item.icon);
    this.root.dataset.cardIndex = String(this.index);
  }

  /**
   * Point the watermark at a sprite symbol, or hide it when the id is missing.
   * @param {string | undefined} name
   */
  #setIcon(name) {
    if (!this.iconUse || !this.iconEl) {
      return;
    }

    const id = name?.trim() ?? "";
    const exists = Boolean(id) && document.getElementById(id);

    if (!exists) {
      this.iconUse.removeAttribute("href");
      this.iconEl.setAttribute("hidden", "");
      return;
    }

    this.iconUse.setAttribute("href", `#${id}`);
    this.iconEl.removeAttribute("hidden");
  }

  static #defaultItems() {
    return [
      { title: "Standard Plan", price: "$49", icon: "icon-generic" },
      { title: "Plus Plan", price: "$79", icon: "icon-generic" },
      { title: "Studio License", price: "$129", icon: "icon-generic" },
    ];
  }
}
