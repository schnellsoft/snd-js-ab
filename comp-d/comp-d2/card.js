const SETTLE_MS = 420;
const COMMIT_DEG = 90;
const FLIP_DEG = 180;

export class Card {
  /**
   * Cache card faces, nav buttons, and the slide list.
   * @param {HTMLElement} root
   * @param {{
   *   items?: Array<{ title: string, price: string, icon?: string }>,
   *   prevButton?: HTMLButtonElement | null,
   *   nextButton?: HTMLButtonElement | null,
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
    /** @type {{ from: number, to: number, start: number, duration: number, nextIndex: number | null } | null} */
    this.settle = null;
    /** @type {{ id: number, x: number, y: number, axis: "x" | "y" | "", angle: number } | null} */
    this.swipe = null;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  /** Bind prev/next controls and paint the current and upcoming faces. */
  connect() {
    if (!this.root || !this.inner || !this.front || !this.back || !this.items.length) {
      return;
    }

    this.controller = new AbortController();
    const { signal } = this.controller;

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
    if (this.#isLocked() || this.items.length < 2) {
      return;
    }

    const nextIndex = this.#offset(step);
    this.#paintFace(this.back, this.items[nextIndex]);
    this.dragStep = step;

    if (this.#prefersReducedMotion()) {
      this.index = nextIndex;
      this.#render();
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

  #rest() {
    this.busy = false;
    this.dragging = false;
    this.dragStep = 0;
    this.angle = 0;
    this.inner.classList.remove("ct-card-inner-live");
    this.inner.style.transform = "";
    this.#render();
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
    const current = this.items[this.index];
    const upcoming = this.items[this.#offset(1)];
    if (!current || !upcoming) {
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
   * @param {HTMLElement} face
   * @param {{ title: string, price: string, icon?: string }} item
   */
  #paintFace(face, item) {
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
