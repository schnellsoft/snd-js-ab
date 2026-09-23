const MAX_LAYOUT_PASSES = 3;
const SUBPIXEL_SLACK = 0.5;
const COMPACT_LABEL_MQ = "(orientation: portrait) and (max-width: 48em)";

export class SndIconsComp {
  /**
   * Cache list, more button, overflow panel, and feature flags.
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
    this.moreEnabled = true;
    /** @type {MediaQueryList | null} */
    this.compactMq = null;
    /** @type {(() => void) | null} */
    this.onCompactChange = null;
    this.supportsPopover = "popover" in HTMLElement.prototype;
    this.supportsAnchor =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      (CSS.supports("anchor-name: --x") || CSS.supports("position-anchor: --x"));
  }

  /** Bind observers, map the more icon, load JSON icons, then layout. */
  connect() {
    if (!this.more || !this.list || !this.overflow) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.#schedule(() => this.layout(0));
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.list);

    this.compactMq = window.matchMedia(COMPACT_LABEL_MQ);
    this.onCompactChange = () => {
      this.itemWidths = new WeakMap();
      this.#schedule(() => this.layout(0));
    };
    this.compactMq.addEventListener("change", this.onCompactChange);

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

    this.#mapMoreIcon();
    this.#loadIcons().then(() => {
      this.layout(0);
    });
  }

  /** Stop resize watching and pending animation frames. */
  disconnect() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.compactMq && this.onCompactChange) {
      this.compactMq.removeEventListener("change", this.onCompactChange);
    }
    this.compactMq = null;
    this.onCompactChange = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /**
   * Show a fitting prefix of items; hide the rest and toggle More.
   * @param {number} pass
   */
  layout(pass = 0) {
    const items = [...this.list.querySelectorAll(".snd-list-item")];

    if (!this.moreEnabled) {
      for (const item of items) {
        item.removeAttribute("hidden");
        item.classList.remove("is-overflow");
      }
      this.more.toggleAttribute("hidden", true);
      this.#hideOverflow();
      this.#syncExpanded();
      return;
    }

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

    const hasOverflow = this.moreEnabled && visibleCount < items.length;
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
   * Return an item's outer width, using cache when it is hidden.
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
   * Read the list's CSS column-gap in pixels.
   * @returns {number}
   */
  #readGap() {
    const raw = getComputedStyle(this.list).columnGap;
    const gap = Number.parseFloat(raw);
    return Number.isFinite(gap) ? gap : 0;
  }

  /** Fetch header-icons.json and sprite.svg, then render matching icons. */
  async #loadIcons() {
    const dataUrl = new URL("data/header-icons.json", import.meta.url);
    const spriteUrl = new URL("sprite.svg", import.meta.url);
    let data;
    let spriteXml;

    try {
      const [dataRes, spriteRes] = await Promise.all([
        fetch(dataUrl),
        fetch(spriteUrl),
      ]);
      if (!dataRes.ok || !spriteRes.ok) {
        return;
      }
      data = await dataRes.json();
      spriteXml = await spriteRes.text();
    } catch {
      return;
    }

    const spriteDoc = new DOMParser().parseFromString(spriteXml, "image/svg+xml");
    const symbolIds = new Set(
      [...spriteDoc.querySelectorAll("symbol[id]")].map((symbol) => symbol.id),
    );
    this.moreEnabled = data.moreList !== false;
    const size = Number.parseFloat(data.baseline) || 24;

    const items = [];
    for (const icon of data.icons ?? []) {
      if (!icon?.name || !symbolIds.has(icon.name)) {
        continue;
      }
      items.push(this.#createItem(icon, size));
    }
    this.list.replaceChildren(...items);
  }

  /** Put the morev sprite icon into the More button. */
  #mapMoreIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "sprite.svg#morev");
    svg.append(use);
    this.more.replaceChildren(svg);
  }

  /**
   * Build one list item (icon link + label) from a JSON icon entry.
   * @param {{ name: string, label?: string, description?: string, link?: string, color?: string, "aria-label"?: string }} icon
   * @param {number} size
   * @returns {HTMLDivElement}
   */
  #createItem(icon, size) {
    const item = document.createElement("div");
    item.className = "snd-list-item";

    const link = document.createElement("a");
    link.className = `snd-list-link brand-${icon.name}`;
    link.href = icon.link || "#";
    if (icon.description) {
      link.title = icon.description;
    }
    const ariaLabel = icon["aria-label"] || icon.description || icon.label;
    if (ariaLabel) {
      link.setAttribute("aria-label", ariaLabel);
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const iconColor = typeof icon.color === "string" ? icon.color.trim() : "";
    if (iconColor) {
      svg.style.setProperty("--snd-icon-color", iconColor);
    }

    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `sprite.svg#${icon.name}`);
    svg.append(use);

    const label = document.createElement("span");
    label.className = "snd-list-label";
    label.append(document.createTextNode(icon.label ?? ""));

    link.append(svg, label);
    item.append(link);
    return item;
  }

  /**
   * Clone overflowed items into the More popover.
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

  /** Close the More popover if it is open. */
  #hideOverflow() {
    if (this.supportsPopover && this.overflow.matches(":popover-open")) {
      this.overflow.hidePopover();
    }
    this.overflow.classList.remove("is-open");
  }

  /** Keep aria-expanded in sync with the popover open state. */
  #syncExpanded() {
    const open = this.supportsPopover
      ? this.overflow.matches(":popover-open")
      : this.overflow.classList.contains("is-open");
    this.more.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /** Place the popover under More when CSS anchor positioning is missing. */
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
   * Coalesce work onto the next animation frame.
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

document.querySelectorAll(".snd-ct-icons .snd-list-comp").forEach((root) => {
  new SndIconsComp(root).connect();
});
