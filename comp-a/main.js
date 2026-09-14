const MAX_LAYOUT_PASSES = 3;
const SUBPIXEL_SLACK = 0.5;

export class SndListComp {
  /**
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.more = root.querySelector(".snd-list-more");
    this.list = root.querySelector(".snd-list");
    this.overflow = root.querySelector(".snd-list-overflow");
    /** @type {WeakMap<Element, number>} */
    this.itemWidths = new WeakMap();
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    this.rafId = 0;
    this.supportsPopover = "popover" in HTMLElement.prototype;
    this.supportsAnchor =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      (CSS.supports("anchor-name: --x") || CSS.supports("position-anchor: --x"));
  }

  connect() {
    if (!this.more || !this.list || !this.overflow) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.#schedule(() => this.layout(0));
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.list);

    this.overflow.addEventListener("toggle", () => {
      this.#syncExpanded();
      this.#positionOverflow();
    });

    if (!this.supportsPopover) {
      this.more.addEventListener("click", () => {
        if (this.more.hidden) {
          return;
        }
        this.overflow.classList.toggle("is-open");
        this.#syncExpanded();
        this.#positionOverflow();
      });
    }

    this.layout(0);
  }

  disconnect() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /**
   * @param {number} pass
   */
  layout(pass = 0) {
    const items = [...this.list.querySelectorAll(".snd-list-item")];
    const gap = this.#readGap();
    const widths = items.map((item) => this.#measureItem(item));
    const available = this.list.clientWidth;

    let used = 0;
    let visibleCount = 0;
    for (let i = 0; i < items.length; i += 1) {
      const extra = visibleCount > 0 ? gap : 0;
      if (used + extra + widths[i] <= available + SUBPIXEL_SLACK) {
        used += extra + widths[i];
        visibleCount += 1;
      } else {
        break;
      }
    }

    for (let i = 0; i < items.length; i += 1) {
      const overflowed = i >= visibleCount;
      items[i].toggleAttribute("hidden", overflowed);
      items[i].classList.toggle("is-overflow", overflowed);
    }

    const hasOverflow = visibleCount < items.length;
    const moreWasHidden = this.more.hidden;
    this.more.toggleAttribute("hidden", !hasOverflow);
    this.#syncOverflowPanel(items.slice(visibleCount));

    if (!hasOverflow) {
      this.#hideOverflow();
    }

    this.#syncExpanded();

    if (moreWasHidden !== this.more.hidden && pass < MAX_LAYOUT_PASSES) {
      this.#schedule(() => this.layout(pass + 1));
    }
  }

  /**
   * @param {Element} item
   * @returns {number}
   */
  #measureItem(item) {
    if (!item.hasAttribute("hidden")) {
      const width = item.getBoundingClientRect().width;
      if (width > 0) {
        this.itemWidths.set(item, width);
      }
    }
    return this.itemWidths.get(item) ?? item.getBoundingClientRect().width;
  }

  /**
   * @returns {number}
   */
  #readGap() {
    const raw = getComputedStyle(this.list).columnGap;
    const gap = Number.parseFloat(raw);
    return Number.isFinite(gap) ? gap : 0;
  }

  /**
   * @param {HTMLElement[]} hiddenItems
   */
  #syncOverflowPanel(hiddenItems) {
    const signature = hiddenItems.map((item) => item.textContent ?? "").join("\0");
    if (signature === this.overflow.dataset.items) {
      return;
    }
    this.overflow.dataset.items = signature;
    this.overflow.replaceChildren(
      ...hiddenItems.map((item) => {
        const clone = item.cloneNode(true);
        clone.removeAttribute("hidden");
        clone.classList.remove("is-overflow");
        return clone;
      }),
    );
  }

  #hideOverflow() {
    if (this.supportsPopover && this.overflow.matches(":popover-open")) {
      this.overflow.hidePopover();
    }
    this.overflow.classList.remove("is-open");
  }

  #syncExpanded() {
    const open = this.supportsPopover
      ? this.overflow.matches(":popover-open")
      : this.overflow.classList.contains("is-open");
    this.more.setAttribute("aria-expanded", open ? "true" : "false");
  }

  #positionOverflow() {
    const open = this.supportsPopover
      ? this.overflow.matches(":popover-open")
      : this.overflow.classList.contains("is-open");
    if (!open || this.supportsAnchor) {
      return;
    }
    const rect = this.more.getBoundingClientRect();
    this.overflow.style.position = "fixed";
    this.overflow.style.inset = "auto";
    this.overflow.style.margin = "0";
    this.overflow.style.top = `${rect.bottom + 4}px`;
    this.overflow.style.left = `${rect.left}px`;
  }

  /**
   * @param {() => void} fn
   */
  #schedule(fn) {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      fn();
    });
  }
}

document.querySelectorAll(".snd-list-comp").forEach((root) => {
  new SndListComp(root).connect();
});
