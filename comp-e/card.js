const SETTLE_MS = 420;
const COMMIT_DEG = 90;
const FLIP_DEG = 180;
const EMPTY_ITEM = { title: "", price: "", icon: "icon-generic" };

export class Card {
  /**
   * Cache card faces, nav buttons, and the slide list.
   * @param {HTMLElement} root
   * @param {{
   *   items?: Array<{ title: string, price: string, icon?: string }>,
   *   prevButton?: HTMLButtonElement | null,
   *   nextButton?: HTMLButtonElement | null,
   *   onIndexChange?: ((index: number) => void) | null,
   *   controls?: boolean,
   * }} [options]
   */
  constructor(root, options = {}) {
    this.root = root;
    this.inner = root.querySelector(".ct-card-inner");
    this.front = root.querySelector(".ct-card-front-face");
    this.back = root.querySelector(".ct-card-back-face");
    this.prevButton = options.prevButton ?? document.querySelector(".left-button");
    this.nextButton = options.nextButton ?? document.querySelector(".right-button");
    this.items = options.items ?? Card.#defaultItems();
    this.index = 0;
    this.busy = false;
    this.dragging = false;
    this.angle = 0;
    this.dragStep = 0;
    this.rafId = 0;
    this.controls = options.controls !== false;
    /** @type {{ from: number, to: number, start: number, duration: number, nextIndex: number | null } | null} */
    this.settle = null;
    /** @type {{ id: number, x: number, y: number, axis: "x" | "y" | "", angle: number } | null} */
    this.swipe = null;
    /** @type {AbortController | null} */
    this.controller = null;
    /** @type {((index: number) => void) | null} */
    this.onIndexChange = options.onIndexChange ?? null;
  }

  /** Bind prev/next controls and paint the current and upcoming faces. */
  connect() {
    if (!this.root || !this.inner || !this.front || !this.back) {
      return;
    }

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.root.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest(".ct-card-select")) {
          event.stopPropagation();
        }
      },
      { signal },
    );

    if (this.controls) {
      this.prevButton?.addEventListener("click", () => this.prev(), { signal });
      this.nextButton?.addEventListener("click", () => this.next(), { signal });
      document.addEventListener("keydown", (event) => this.#onKey(event), { signal });
      this.root.addEventListener("touchstart", (event) => this.#onTouchStart(event), {
        signal,
        passive: true,
      });
      this.root.addEventListener("touchmove", (event) => this.#onTouchMove(event), {
        signal,
        passive: false,
      });
      this.root.addEventListener("touchend", (event) => this.#onTouchEnd(event), { signal });
      this.root.addEventListener("touchcancel", () => this.#onTouchCancel(), { signal });
    }

    this.root.setAttribute("aria-live", "polite");
    this.#render();
  }

  /** Remove listeners bound by connect(). */
  disconnect() {
    this.controller?.abort();
    this.controller = null;
    this.#stopLoop();
    this.inner?.classList.remove("ct-card-inner-live");
    if (this.inner) {
      this.inner.style.transform = "";
    }
  }

  prev() {
    this.#go(-1);
  }

  next() {
    this.#go(1);
  }

  /**
   * Replace the slide list and show the item at index.
   * @param {Array<{ title: string, price: string, icon?: string }>} items
   * @param {number} [index]
   */
  setItems(items, index = 0) {
    this.items = Array.isArray(items) ? items : [];
    this.#park(index);
  }

  /**
   * Jump to an item without replacing the list.
   * @param {number} index
   */
  setIndex(index) {
    this.#park(index);
  }

  /**
   * @param {number} step
   */
  #go(step) {
    if (this.#isLocked() || this.items.length < 2) {
      return;
    }

    const nextIndex = this.#offset(step);
    this.#paintFace(this.back, this.items[nextIndex]);
    this.dragStep = step;

    if (this.#prefersReducedMotion()) {
      this.index = nextIndex;
      this.#rest();
      return;
    }

    this.angle = 0;
    this.#applyAngle(0);
    this.#startSettle(step > 0 ? -FLIP_DEG : FLIP_DEG, nextIndex);
  }

  /**
   * @param {KeyboardEvent} event
   */
  #onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable='true']")) {
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

  /**
   * @param {TouchEvent} event
   */
  #onTouchStart(event) {
    if (event.target instanceof Element && event.target.closest(".ct-card-select")) {
      return;
    }

    if (this.#isLocked() || this.items.length < 2 || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    this.swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: "", angle: 0 };
  }

  /**
   * @param {TouchEvent} event
   */
  #onTouchMove(event) {
    if (!this.swipe || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    if (touch.identifier !== this.swipe.id) {
      return;
    }

    const dx = touch.clientX - this.swipe.x;
    const dy = touch.clientY - this.swipe.y;

    if (!this.swipe.axis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        return;
      }
      this.swipe.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (this.swipe.axis === "x") {
        this.dragging = true;
        this.inner.classList.add("ct-card-inner-live");
      }
    }

    if (this.swipe.axis !== "x") {
      return;
    }

    event.preventDefault();
    this.swipe.angle = this.#angleFromDx(dx);
    this.#syncBackForAngle(this.swipe.angle);
    this.#schedule();
  }

  /**
   * @param {TouchEvent} event
   */
  #onTouchEnd(event) {
    if (!this.swipe) {
      return;
    }

    if (this.swipe.axis !== "x") {
      this.#clearSwipe();
      return;
    }

    const touch = [...event.changedTouches].find((item) => item.identifier === this.swipe.id);
    if (touch) {
      this.swipe.angle = this.#angleFromDx(touch.clientX - this.swipe.x);
    }

    const angle = this.swipe.angle;
    this.#clearSwipe();
    this.dragging = false;
    this.#release(angle);
  }

  #onTouchCancel() {
    if (!this.swipe) {
      return;
    }

    if (this.swipe.axis !== "x") {
      this.#clearSwipe();
      return;
    }

    const angle = this.swipe.angle;
    this.#clearSwipe();
    this.dragging = false;
    this.#release(angle);
  }

  /**
   * @param {number} angle
   */
  #release(angle) {
    this.#applyAngle(angle);

    if (this.#prefersReducedMotion()) {
      if (Math.abs(angle) > COMMIT_DEG) {
        this.index = this.#offset(angle < 0 ? 1 : -1);
      }
      this.#rest();
      return;
    }

    if (Math.abs(angle) > COMMIT_DEG) {
      const step = angle < 0 ? 1 : -1;
      this.#startSettle(Math.sign(angle) * FLIP_DEG, this.#offset(step));
      return;
    }

    this.#startSettle(0, null);
  }

  /**
   * @param {number} to
   * @param {number | null} nextIndex
   */
  #startSettle(to, nextIndex) {
    this.busy = true;
    this.inner.classList.add("ct-card-inner-live");
    const distance = Math.abs(to - this.angle);
    this.settle = {
      from: this.angle,
      to,
      start: performance.now(),
      duration: Math.max(220, SETTLE_MS * (distance / FLIP_DEG)),
      nextIndex,
    };
    this.#schedule();
  }

  #schedule() {
    if (this.rafId) {
      return;
    }
    this.rafId = requestAnimationFrame((now) => this.#tick(now));
  }

  /**
   * @param {number} now
   */
  #tick(now) {
    this.rafId = 0;

    if (this.settle) {
      const t = Math.min(1, (now - this.settle.start) / this.settle.duration);
      const eased = 1 - (1 - t) ** 3;
      this.#applyAngle(this.settle.from + (this.settle.to - this.settle.from) * eased);

      if (t < 1) {
        this.#schedule();
        return;
      }

      const nextIndex = this.settle.nextIndex;
      this.settle = null;
      if (nextIndex != null) {
        this.index = nextIndex;
      }
      this.#rest();
      return;
    }

    if (this.dragging && this.swipe) {
      this.#applyAngle(this.swipe.angle);
    }
  }

  /**
   * @param {number} [index]
   */
  #park(index = this.index) {
    this.#stopLoop();
    this.busy = false;
    this.dragging = false;
    this.swipe = null;
    this.angle = 0;
    this.inner?.classList.remove("ct-card-inner-live");
    if (this.inner) {
      this.inner.style.transform = "";
    }
    this.index = this.items.length ? Math.min(Math.max(0, index), this.items.length - 1) : 0;
    this.#render();
    this.onIndexChange?.(this.index);
  }

  /**
   * @param {{ title: string, price: string, icon?: string } | null | undefined} item
   */
  paintFront(item) {
    this.#paintFace(this.front, item ?? EMPTY_ITEM);
  }

  /**
   * @param {{ title: string, price: string, icon?: string } | null | undefined} item
   */
  paintBack(item) {
    this.#paintFace(this.back, item ?? EMPTY_ITEM);
  }

  /**
   * @param {number} deg
   */
  applyAngle(deg) {
    this.#applyAngle(deg);
  }

  /**
   * @param {boolean} on
   */
  setLive(on) {
    this.inner?.classList.toggle("ct-card-inner-live", on);
  }

  resetPose() {
    this.busy = false;
    this.dragging = false;
    this.angle = 0;
    this.setLive(false);
    if (this.inner) {
      this.inner.style.transform = "";
    }
  }

  /**
   * @param {boolean} on
   */
  setVisible(on) {
    this.root.toggleAttribute("hidden", !on);
  }

  #rest() {
    this.busy = false;
    this.dragging = false;
    this.dragStep = 0;
    this.angle = 0;
    this.inner.classList.remove("ct-card-inner-live");
    this.inner.style.transform = "";
    this.#render();
    this.onIndexChange?.(this.index);
  }

  #stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.settle = null;
  }

  /**
   * @param {number} deg
   */
  #applyAngle(deg) {
    this.angle = deg;
    this.inner.style.transform = `rotateY(${deg}deg)`;
  }

  /**
   * @param {number} dx
   */
  #angleFromDx(dx) {
    const width = this.root.getBoundingClientRect().width || 1;
    return Math.max(-FLIP_DEG, Math.min(FLIP_DEG, (dx / width) * FLIP_DEG));
  }

  /**
   * @param {number} angle
   */
  #syncBackForAngle(angle) {
    const step = angle < 0 ? 1 : angle > 0 ? -1 : 0;
    if (!step || step === this.dragStep) {
      return;
    }

    this.dragStep = step;
    this.#paintFace(this.back, this.items[this.#offset(step)]);
  }

  #clearSwipe() {
    this.swipe = null;
  }

  #isLocked() {
    return this.busy || this.dragging || Boolean(this.settle);
  }

  #prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #render() {
    if (!this.items.length) {
      const empty = { title: "", price: "", icon: "icon-generic" };
      this.#paintFace(this.front, empty);
      this.#paintFace(this.back, empty);
      this.root.dataset.cardIndex = "0";
      return;
    }

    const current = this.items[this.index];
    const upcoming = this.items[this.#offset(1)] ?? current;
    if (!current) {
      return;
    }

    this.#paintFace(this.front, current);
    this.#paintFace(this.back, upcoming);
    this.root.dataset.cardIndex = String(this.index);
  }

  /**
   * @param {number} step
   */
  #offset(step) {
    const count = this.items.length;
    return (this.index + step + count) % count;
  }

  /**
   * @param {HTMLElement | null} face
   * @param {{ title: string, price: string, icon?: string }} item
   */
  #paintFace(face, item) {
    if (!face || !item) {
      return;
    }
    const titleEl = face.querySelector(".ct-card-title");
    const priceEl = face.querySelector(".ct-card-price");
    const iconEl = face.querySelector(".ct-card-bg");
    const iconUse = iconEl?.querySelector("use") ?? null;

    if (titleEl) {
      titleEl.textContent = item.title;
    }
    if (priceEl) {
      priceEl.textContent = item.price;
    }
    this.#setIcon(iconEl, iconUse, item.icon);
  }

  /**
   * Point a face watermark at a sprite symbol, or hide it when the id is missing.
   * @param {HTMLElement | null | undefined} iconEl
   * @param {SVGUseElement | null} iconUse
   * @param {string | undefined} name
   */
  #setIcon(iconEl, iconUse, name) {
    if (!iconUse || !iconEl) {
      return;
    }

    const id = name?.trim() ?? "";
    const exists = Boolean(id) && document.getElementById(id);

    if (!exists) {
      iconUse.removeAttribute("href");
      iconEl.setAttribute("hidden", "");
      return;
    }

    iconUse.setAttribute("href", `#${id}`);
    iconEl.removeAttribute("hidden");
  }

  static #defaultItems() {
    return [
      { title: "Standard Plan", price: "$49", icon: "icon-generic" },
      { title: "Plus Plan", price: "$79", icon: "icon-generic" },
      { title: "Studio License", price: "$129", icon: "icon-generic" },
    ];
  }
}

export class Deck {
  /**
   * @param {HTMLElement} main
   * @param {{
   *   onStep?: (step: number) => void,
   *   prevButton?: HTMLButtonElement | null,
   *   nextButton?: HTMLButtonElement | null,
   * }} [options]
   */
  constructor(main, options = {}) {
    this.main = main;
    this.template = main.querySelector(".ct-card");
    /** @type {Card[]} */
    this.cards = [];
    /** @type {((step: number, alreadyFlipped?: boolean) => void) | null} */
    this.onStep = options.onStep ?? null;
    this.prevButton = options.prevButton ?? document.querySelector(".left-button");
    this.nextButton = options.nextButton ?? document.querySelector(".right-button");
    this.busy = false;
    this.dragging = false;
    this.angle = 0;
    this.dragStep = 0;
    this.rafId = 0;
    /** @type {{ from: number, to: number, start: number, duration: number, commit: boolean } | null} */
    this.settle = null;
    /** @type {{ id: number, x: number, y: number, axis: "x" | "y" | "", angle: number } | null} */
    this.swipe = null;
    /** @type {(() => void) | null} */
    this.onFlipDone = null;
    /** @type {Array<{ title: string, price: string, icon?: string }>} */
    this.nextItems = [];
    /** @type {Array<{ title: string, price: string, icon?: string }>} */
    this.prevItems = [];
    /** @type {AbortController | null} */
    this.controller = null;
  }

  connect() {
    if (!this.main || !(this.template instanceof HTMLElement)) {
      return;
    }

    this.#ensure(1);
    this.controller = new AbortController();
    const { signal } = this.controller;

    this.prevButton?.addEventListener("click", () => this.onStep?.(-1), { signal });
    this.nextButton?.addEventListener("click", () => this.onStep?.(1), { signal });
    document.addEventListener("keydown", (event) => this.#onKey(event), { signal });
    this.main.addEventListener("touchstart", (event) => this.#onTouchStart(event), {
      signal,
      passive: true,
    });
    this.main.addEventListener("touchmove", (event) => this.#onTouchMove(event), {
      signal,
      passive: false,
    });
    this.main.addEventListener("touchend", (event) => this.#onTouchEnd(event), { signal });
    this.main.addEventListener("touchcancel", () => this.#onTouchCancel(), { signal });
  }

  disconnect() {
    this.controller?.abort();
    this.controller = null;
    this.#stopLoop();
    this.cards.forEach((card) => card.disconnect());
    this.cards = [];
  }

  /**
   * @param {Array<{ title: string, price: string, icon?: string }>} fronts
   * @param {Array<{ title: string, price: string, icon?: string }>} nexts
   * @param {Array<{ title: string, price: string, icon?: string }>} prevs
   */
  setWindow(fronts, nexts, prevs) {
    this.nextItems = nexts;
    this.prevItems = prevs;
    this.#ensure(Math.max(1, fronts.length));
    this.cards.forEach((card, index) => {
      const on = index < fronts.length;
      card.setVisible(on);
      if (!on) {
        card.resetPose();
        return;
      }
      card.paintFront(fronts[index]);
      card.paintBack(nexts[index] ?? fronts[index]);
      card.resetPose();
    });
    this.busy = false;
    this.dragging = false;
    this.dragStep = 0;
    this.angle = 0;
  }

  /**
   * @param {number} step
   * @param {Array<{ title: string, price: string, icon?: string }>} backs
   * @param {() => void} [done]
   */
  flip(step, backs, done) {
    if (this.busy) {
      return;
    }

    const visible = this.#visible();
    if (!visible.length) {
      done?.();
      return;
    }

    this.busy = true;
    this.onFlipDone = done ?? null;
    this.dragStep = step;
    visible.forEach((card, index) => {
      card.paintBack(backs[index] ?? EMPTY_ITEM);
    });

    if (this.#prefersReducedMotion()) {
      this.#finishFlip();
      return;
    }

    this.angle = 0;
    this.#forVisible((card) => {
      card.setLive(true);
      card.applyAngle(0);
    });
    this.#startSettle(step > 0 ? -FLIP_DEG : FLIP_DEG, true);
  }

  /**
   * @param {number} count
   */
  #ensure(count) {
    if (!(this.template instanceof HTMLElement)) {
      return;
    }

    if (!this.cards.length) {
      const first = new Card(this.template, { controls: false, items: [EMPTY_ITEM] });
      first.connect();
      this.cards.push(first);
    }

    while (this.cards.length < count) {
      const node = this.template.cloneNode(true);
      if (!(node instanceof HTMLElement)) {
        break;
      }
      this.main.append(node);
      const card = new Card(node, { controls: false, items: [EMPTY_ITEM] });
      card.connect();
      this.cards.push(card);
    }
  }

  /** @returns {Card[]} */
  #visible() {
    return this.cards.filter((card) => !card.root.hasAttribute("hidden"));
  }

  /**
   * @param {(card: Card) => void} fn
   */
  #forVisible(fn) {
    this.#visible().forEach(fn);
  }

  /**
   * @param {KeyboardEvent} event
   */
  #onKey(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [contenteditable='true']")) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      this.onStep?.(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      this.onStep?.(1);
    }
  }

  /**
   * @param {TouchEvent} event
   */
  #onTouchStart(event) {
    if (event.target instanceof Element && event.target.closest(".ct-card-select")) {
      return;
    }
    if (!(event.target instanceof Element) || !event.target.closest(".ct-card")) {
      return;
    }
    if (this.busy || this.#visible().length < 1 || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    this.swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY, axis: "", angle: 0 };
  }

  /**
   * @param {TouchEvent} event
   */
  #onTouchMove(event) {
    if (!this.swipe || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    if (touch.identifier !== this.swipe.id) {
      return;
    }

    const dx = touch.clientX - this.swipe.x;
    const dy = touch.clientY - this.swipe.y;

    if (!this.swipe.axis) {
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12) {
        return;
      }
      this.swipe.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (this.swipe.axis === "x") {
        this.dragging = true;
        this.#forVisible((card) => card.setLive(true));
      }
    }

    if (this.swipe.axis !== "x") {
      return;
    }

    event.preventDefault();
    this.swipe.angle = this.#angleFromDx(dx);
    this.#syncBacks(this.swipe.angle);
    this.#schedule();
  }

  /**
   * @param {TouchEvent} event
   */
  #onTouchEnd(event) {
    if (!this.swipe) {
      return;
    }

    if (this.swipe.axis !== "x") {
      this.swipe = null;
      return;
    }

    const touch = [...event.changedTouches].find((item) => item.identifier === this.swipe.id);
    if (touch) {
      this.swipe.angle = this.#angleFromDx(touch.clientX - this.swipe.x);
    }

    const angle = this.swipe.angle;
    this.swipe = null;
    this.dragging = false;
    this.#release(angle);
  }

  #onTouchCancel() {
    if (!this.swipe) {
      return;
    }

    if (this.swipe.axis !== "x") {
      this.swipe = null;
      return;
    }

    const angle = this.swipe.angle;
    this.swipe = null;
    this.dragging = false;
    this.#release(angle);
  }

  /**
   * @param {number} angle
   */
  #syncBacks(angle) {
    const step = angle < 0 ? 1 : angle > 0 ? -1 : 0;
    if (!step || step === this.dragStep) {
      return;
    }

    this.dragStep = step;
    const backs = step > 0 ? this.nextItems : this.prevItems;
    this.#visible().forEach((card, index) => {
      card.paintBack(backs[index] ?? EMPTY_ITEM);
    });
  }

  /**
   * @param {number} angle
   */
  #release(angle) {
    this.#forVisible((card) => card.applyAngle(angle));
    this.angle = angle;

    if (this.#prefersReducedMotion()) {
      if (Math.abs(angle) > COMMIT_DEG) {
        this.onStep?.(angle < 0 ? 1 : -1, true);
      }
      this.#forVisible((card) => card.resetPose());
      this.busy = false;
      return;
    }

    if (Math.abs(angle) > COMMIT_DEG) {
      this.busy = true;
      this.onFlipDone = () => this.onStep?.(angle < 0 ? 1 : -1, true);
      this.#startSettle(Math.sign(angle) * FLIP_DEG, true);
      return;
    }

    this.busy = true;
    this.onFlipDone = null;
    this.#startSettle(0, false);
  }

  /**
   * @param {number} to
   * @param {boolean} commit
   */
  #startSettle(to, commit) {
    this.busy = true;
    this.#forVisible((card) => card.setLive(true));
    const distance = Math.abs(to - this.angle);
    this.settle = {
      from: this.angle,
      to,
      start: performance.now(),
      duration: Math.max(220, SETTLE_MS * (distance / FLIP_DEG)),
      commit,
    };
    this.#schedule();
  }

  #schedule() {
    if (this.rafId) {
      return;
    }
    this.rafId = requestAnimationFrame((now) => this.#tick(now));
  }

  /**
   * @param {number} now
   */
  #tick(now) {
    this.rafId = 0;

    if (this.settle) {
      const t = Math.min(1, (now - this.settle.start) / this.settle.duration);
      const eased = 1 - (1 - t) ** 3;
      this.angle = this.settle.from + (this.settle.to - this.settle.from) * eased;
      this.#forVisible((card) => card.applyAngle(this.angle));

      if (t < 1) {
        this.#schedule();
        return;
      }

      const commit = this.settle.commit;
      this.settle = null;
      if (commit) {
        this.#finishFlip();
        return;
      }

      this.#forVisible((card) => card.resetPose());
      this.busy = false;
      return;
    }

    if (this.dragging && this.swipe) {
      this.angle = this.swipe.angle;
      this.#forVisible((card) => card.applyAngle(this.angle));
    }
  }

  #finishFlip() {
    this.#stopLoop();
    this.#forVisible((card) => card.resetPose());
    this.busy = false;
    this.dragging = false;
    this.dragStep = 0;
    this.angle = 0;
    const done = this.onFlipDone;
    this.onFlipDone = null;
    done?.();
  }

  #stopLoop() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.settle = null;
  }

  /**
   * @param {number} dx
   */
  #angleFromDx(dx) {
    const card = this.#visible()[0];
    const width = card?.root.getBoundingClientRect().width || 1;
    return Math.max(-FLIP_DEG, Math.min(FLIP_DEG, (dx / width) * FLIP_DEG));
  }

  #prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
