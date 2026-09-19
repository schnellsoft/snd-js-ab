import { Card } from "./card.js";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const MIN_MS = 220;
const MAX_MS = 560;
const AXIS_PX = 12;
const FLICK_PX = 0.35;

/**
 * Horizontal card slider modeled on UIkit Slider:
 * clipped container, flex items, drag, prev/next, optional infinite wrap.
 */
export class Slider {
  /**
   * @param {HTMLElement} main
   * @param {{
   *   onIndexChange?: ((index: number) => void) | null,
   *   prevButton?: HTMLButtonElement | null,
   *   nextButton?: HTMLButtonElement | null,
   *   finite?: boolean,
   *   velocity?: number,
   * }} [options]
   */
  constructor(main, options = {}) {
    this.main = main;
    this.root = main.querySelector(".ct-slider") ?? main;
    this.container = this.root.querySelector(".ct-slider-container") ?? this.root;
    this.list = this.root.querySelector(".ct-slider-items");
    /** @type {HTMLElement | null} */
    this.template = null;
    this.prevButton = options.prevButton ?? document.querySelector(".left-button");
    this.nextButton = options.nextButton ?? document.querySelector(".right-button");
    /** @type {((index: number) => void) | null} */
    this.onIndexChange = options.onIndexChange ?? null;
    this.finite = Boolean(options.finite);
    this.velocity = options.velocity ?? 1;
    /** @type {Array<{ title: string, price: string, icon?: string }>} */
    this.items = [];
    this.index = 0;
    this.perView = 1;
    this.gap = 16;
    this.stride = 0;
    this.pad = 0;
    this.translate = 0;
    this.busy = false;
    this.dragMoved = false;
    /** @type {{ id: number, x: number, y: number, axis: "x" | "y" | "", origin: number, lastX: number, lastT: number, vx: number } | null} */
    this.drag = null;
    /** @type {Array<1 | -1>} */
    this.stack = [];
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  connect() {
    if (!(this.list instanceof HTMLElement)) {
      return;
    }

    const first = this.list.querySelector(".ct-slider-item");
    if (first instanceof HTMLElement) {
      this.template = /** @type {HTMLElement} */ (first.cloneNode(true));
      this.list.replaceChildren();
    }

    this.root.setAttribute("aria-roledescription", "carousel");
    if (!this.root.getAttribute("aria-label")) {
      this.root.setAttribute("aria-label", "Services");
    }
    this.root.tabIndex = this.root.tabIndex >= 0 ? this.root.tabIndex : -1;

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.prevButton?.addEventListener("click", () => this.prev(), { signal });
    this.nextButton?.addEventListener("click", () => this.next(), { signal });
    document.addEventListener("keydown", (event) => this.#onKey(event), { signal });
    this.container.addEventListener("pointerdown", (event) => this.#onPointerDown(event), { signal });
    this.container.addEventListener("pointermove", (event) => this.#onPointerMove(event), { signal });
    this.container.addEventListener("pointerup", (event) => this.#onPointerUp(event), { signal });
    this.container.addEventListener("pointercancel", (event) => this.#onPointerUp(event), { signal });
    this.container.addEventListener("lostpointercapture", (event) => this.#onPointerUp(event), { signal });
    this.list.addEventListener("transitionend", (event) => this.#onTransitionEnd(event), { signal });
    this.container.addEventListener(
      "click",
      (event) => {
        if (this.dragMoved) {
          event.preventDefault();
          event.stopPropagation();
          this.dragMoved = false;
        }
      },
      { signal, capture: true },
    );

    this.resizeObserver = new ResizeObserver(() => this.#onResize());
    this.resizeObserver.observe(this.container);
  }

  disconnect() {
    this.controller?.abort();
    this.controller = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.drag = null;
    this.stack = [];
    this.busy = false;
  }

  /**
   * Replace slides and park on index.
   * @param {Array<{ title: string, price: string, icon?: string }>} items
   * @param {number} [index]
   */
  setItems(items, index = 0) {
    this.items = Array.isArray(items) ? items : [];
    this.stack = [];
    this.busy = false;
    this.#render();
    this.#park(index, false);
  }

  /**
   * Jump to an item. Used by search/category, so this is instant.
   * @param {number} index
   */
  show(index) {
    this.stack = [];
    this.busy = false;
    this.#goTo(index, false);
  }

  prev() {
    this.#step(-1);
  }

  next() {
    this.#step(1);
  }

  #step(dir) {
    if (this.items.length < 2 || this.items.length <= this.perView) {
      return;
    }
    if (this.busy) {
      this.stack.push(dir);
      return;
    }
    this.#snapToList(this.#listIndex(this.index) + dir, true);
  }

  /**
   * @param {number} index
   * @param {boolean} animate
   */
  #goTo(index, animate) {
    if (!this.items.length) {
      this.index = 0;
      this.#setTranslate(0, false);
      this.onIndexChange?.(0);
      return;
    }

    this.index = this.#clampIndex(index);
    this.#updateActive();
    this.#setTranslate(-this.#listIndex(this.index) * this.stride, animate && !this.#prefersReducedMotion());
    if (!this.busy) {
      this.onIndexChange?.(this.index);
    }
  }

  /**
   * @param {number} listIndex
   * @param {boolean} animate
   */
  #snapToList(listIndex, animate) {
    if (!this.items.length) {
      this.#goTo(0, false);
      return;
    }

    let target = listIndex;
    let real = listIndex - this.pad;
    if (this.finite) {
      real = this.#clampIndex(real);
      target = this.#listIndex(real);
    } else {
      const total = this.items.length;
      real = ((real % total) + total) % total;
    }

    this.index = real;
    this.#updateActive();
    this.#setTranslate(-target * this.stride, animate && !this.#prefersReducedMotion());
    if (!this.busy) {
      this.#normalize();
      this.onIndexChange?.(this.index);
    }
  }

  /**
   * @param {number} index
   * @param {boolean} animate
   */
  #park(index, animate) {
    this.#goTo(index, animate);
  }

  #render() {
    if (!this.list || !this.template) {
      return;
    }

    this.#measurePerView();
    this.pad = !this.finite && this.items.length > this.perView ? this.perView : 0;
    this.list.replaceChildren();

    if (!this.items.length) {
      this.translate = 0;
      this.list.style.transform = "translate3d(0,0,0)";
      this.#syncButtons();
      return;
    }

    const nodes = [];
    if (this.pad) {
      for (let i = this.items.length - this.pad; i < this.items.length; i += 1) {
        nodes.push(this.#makeSlide(this.items[i], i, true));
      }
    }
    this.items.forEach((item, i) => {
      nodes.push(this.#makeSlide(item, i, false));
    });
    if (this.pad) {
      for (let i = 0; i < this.pad; i += 1) {
        nodes.push(this.#makeSlide(this.items[i], i, true));
      }
    }

    nodes.forEach((node, listIndex) => {
      node.id = `ct-slider-slide-${listIndex}`;
    });
    this.list.append(...nodes);
    this.#measureStride();
    this.#syncButtons();
  }

  /**
   * @param {{ title: string, price: string, icon?: string }} item
   * @param {number} itemIndex
   * @param {boolean} clone
   */
  #makeSlide(item, itemIndex, clone) {
    const node = /** @type {HTMLElement} */ (this.template.cloneNode(true));
    node.classList.add("ct-slider-item");
    node.setAttribute("role", "group");
    node.setAttribute("aria-roledescription", "slide");
    node.setAttribute("data-index", String(itemIndex));
    node.toggleAttribute("data-clone", clone);
    if (clone) {
      node.setAttribute("aria-hidden", "true");
    }
    const cardRoot = node.querySelector(".ct-card");
    if (cardRoot instanceof HTMLElement) {
      new Card(cardRoot).paint(item);
    }
    return node;
  }

  #measurePerView() {
    const width = this.list?.clientWidth || this.container.clientWidth;
    const listStyles = this.list ? getComputedStyle(this.list) : null;
    this.gap = Number.parseFloat(listStyles?.columnGap || listStyles?.gap || "") || 16;
    const minCard = Number.parseFloat(getComputedStyle(this.main).getPropertyValue("--ct-card-min-px")) || 240;
    this.perView = width <= 0 ? 1 : Math.max(1, Math.floor((width + this.gap) / (minCard + this.gap)));
    this.list?.style.setProperty("--ct-slider-per", String(this.perView));
    this.list?.style.setProperty("--ct-slider-gap", `${this.gap}px`);
  }

  #measureStride() {
    const first = this.list?.querySelector(".ct-slider-item");
    if (!(first instanceof HTMLElement)) {
      this.stride = 0;
      return;
    }
    this.stride = first.getBoundingClientRect().width + this.gap;
  }

  /**
   * @param {number} index
   */
  #clampIndex(index) {
    const total = this.items.length;
    if (!total) {
      return 0;
    }
    if (!this.finite) {
      return ((index % total) + total) % total;
    }
    const max = Math.max(0, total - this.perView);
    return Math.min(Math.max(0, index), max);
  }

  /**
   * @param {number} index
   */
  #listIndex(index) {
    return this.pad + this.#clampIndex(index);
  }

  /**
   * @param {number} value
   * @param {boolean} animate
   */
  #setTranslate(value, animate) {
    if (!this.list) {
      return;
    }
    const reduce = this.#prefersReducedMotion();
    const distance = Math.abs(value - this.translate);
    const duration =
      reduce || !animate || distance < 1
        ? 0
        : Math.round(Math.min(MAX_MS, Math.max(MIN_MS, distance / this.velocity)));
    this.translate = value;
    this.busy = Boolean(animate && duration);
    this.list.classList.toggle("ct-slider-items-live", this.busy);
    this.list.style.transition = duration ? `transform ${duration}ms ${EASE}` : "none";
    this.list.style.transform = `translate3d(${value}px, 0, 0)`;
    if (!this.busy) {
      this.#flushStack();
    }
  }

  #onTransitionEnd(event) {
    if (event.target !== this.list || event.propertyName !== "transform") {
      return;
    }
    this.busy = false;
    this.list?.classList.remove("ct-slider-items-live");
    this.#normalize();
    this.onIndexChange?.(this.index);
    this.#flushStack();
  }

  #normalize() {
    if (!this.pad) {
      this.#setTranslate(-this.#listIndex(this.index) * this.stride, false);
      return;
    }
    this.#setTranslate(-this.#listIndex(this.index) * this.stride, false);
  }

  #flushStack() {
    const dir = this.stack.shift();
    if (dir) {
      this.#step(dir);
    }
  }

  #updateActive() {
    if (!this.list) {
      return;
    }
    const slides = [...this.list.children];
    slides.forEach((slide, listIndex) => {
      if (!(slide instanceof HTMLElement)) {
        return;
      }
      const clone = slide.hasAttribute("data-clone");
      const itemIndex = Number(slide.dataset.index);
      const visible = !clone && itemIndex >= this.index && itemIndex < this.index + this.perView;
      slide.classList.toggle("ct-slider-item-active", visible);
      slide.setAttribute("aria-hidden", visible ? "false" : "true");
      slide.toggleAttribute("inert", !visible);
      slide.setAttribute("aria-label", `${itemIndex + 1} of ${this.items.length}`);
      if (listIndex === this.#listIndex(this.index)) {
        this.root.setAttribute("aria-activedescendant", slide.id || "");
      }
    });
    this.#syncButtons();
  }

  #syncButtons() {
    const many = this.items.length > this.perView;
    const atStart = this.finite && this.index <= 0;
    const atEnd = this.finite && this.index >= Math.max(0, this.items.length - this.perView);
    this.prevButton?.toggleAttribute("disabled", !many || atStart);
    this.nextButton?.toggleAttribute("disabled", !many || atEnd);
  }

  #onResize() {
    const prev = this.perView;
    this.#measurePerView();
    const nextPad = !this.finite && this.items.length > this.perView ? this.perView : 0;
    if (nextPad !== this.pad || this.perView !== prev) {
      const index = this.index;
      this.#render();
      this.#park(index, false);
      return;
    }
    this.#measureStride();
    this.#setTranslate(-this.#listIndex(this.index) * this.stride, false);
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
   * @param {PointerEvent} event
   */
  #onPointerDown(event) {
    if (event.button !== 0 || this.items.length < 2) {
      return;
    }
    if (event.target instanceof Element && event.target.closest(".ct-card-select")) {
      return;
    }
    this.dragMoved = false;
    this.stack = [];
    this.busy = false;
    if (this.list) {
      this.list.style.transition = "none";
      this.list.classList.remove("ct-slider-items-live");
    }
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: "",
      origin: this.translate,
      lastX: event.clientX,
      lastT: performance.now(),
      vx: 0,
    };
    this.container.classList.add("ct-slider-dragging");
    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      /* capture is optional */
    }
  }

  /**
   * @param {PointerEvent} event
   */
  #onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.id) {
      return;
    }

    const dx = event.clientX - this.drag.x;
    const dy = event.clientY - this.drag.y;

    if (!this.drag.axis) {
      if (Math.abs(dx) < AXIS_PX && Math.abs(dy) < AXIS_PX) {
        return;
      }
      this.drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      if (this.drag.axis === "y") {
        this.#releasePointer(event.pointerId);
        this.drag = null;
        this.container.classList.remove("ct-slider-dragging");
        return;
      }
    }

    if (this.drag.axis !== "x") {
      return;
    }

    event.preventDefault();
    const now = performance.now();
    const dt = Math.max(1, now - this.drag.lastT);
    this.drag.vx = (event.clientX - this.drag.lastX) / dt;
    this.drag.lastX = event.clientX;
    this.drag.lastT = now;
    this.dragMoved = Math.abs(dx) > 4;

    let next = this.drag.origin + dx;
    if (this.finite) {
      const min = -Math.max(0, this.items.length - this.perView) * this.stride;
      next = this.#rubber(next, min, 0);
    }
    this.translate = next;
    if (this.list) {
      this.list.style.transform = `translate3d(${next}px, 0, 0)`;
    }
  }

  /**
   * @param {PointerEvent} event
   */
  #onPointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.id) {
      return;
    }

    const drag = this.drag;
    this.drag = null;
    this.container.classList.remove("ct-slider-dragging");
    this.#releasePointer(event.pointerId);

    if (drag.axis !== "x") {
      return;
    }

    const projected = this.translate + drag.vx * 180;
    let listIndex = this.stride ? Math.round(-projected / this.stride) : this.#listIndex(this.index);

    if (Math.abs(drag.vx) > FLICK_PX) {
      const dir = drag.vx < 0 ? 1 : -1;
      const current = this.stride ? -this.translate / this.stride : this.#listIndex(this.index);
      listIndex = dir > 0 ? Math.ceil(current - 0.01) : Math.floor(current + 0.01);
    }

    this.#snapToList(listIndex, true);
  }

  /**
   * @param {number} id
   */
  #releasePointer(id) {
    if (this.container.hasPointerCapture?.(id)) {
      try {
        this.container.releasePointerCapture(id);
      } catch {
        /* already released */
      }
    }
  }

  /**
   * @param {number} value
   * @param {number} min
   * @param {number} max
   */
  #rubber(value, min, max) {
    if (value > max) {
      return max + (value - max) * 0.35;
    }
    if (value < min) {
      return min + (value - min) * 0.35;
    }
    return value;
  }

  #prefersReducedMotion() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
}
