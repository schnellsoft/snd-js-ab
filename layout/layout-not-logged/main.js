import { languageFolder, onLanguageChange } from "./lang.js";

const MAX_LAYOUT_PASSES = 3;
const SUBPIXEL_SLACK = 0.5;
const MAX_MENU_LEVEL = 3;
const COMPACT_MQ = "(orientation: portrait) and (max-width: 48em)";

export class SndListComp {
  /**
   * Cache list, more, hamburger, panels, and feature flags.
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.more = root.querySelector(".snd-list-more");
    this.list = root.querySelector(".snd-list");
    this.listCt = root.querySelector(".snd-list-ct");
    this.overflow = root.querySelector(".snd-list-overflow");
    this.hamburger = root.querySelector(".snd-list-hamburger");
    this.drawer = root.querySelector(".snd-menu-drawer");
    /** @type {WeakMap<Element, number>} */
    this.itemWidths = new WeakMap();
    /** @type {Set<string>} */
    this.symbolIds = new Set();
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    this.rafId = 0;
    /** @type {WeakMap<Element, number>} */
    this.submenuAnims = new WeakMap();
    this.moreEnabled = true;
    this.iconSize = 24;
    /** @type {MediaQueryList | null} */
    this.compactMq = null;
    /** @type {(() => void) | null} */
    this.onCompactChange = null;
    /** @type {(() => void) | null} */
    this.onDocumentPointerDown = null;
    /** @type {(() => void) | null} */
    this.onWinResize = null;
    this.supportsPopover = "popover" in HTMLElement.prototype;
    this.supportsAnchor =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      (CSS.supports("anchor-name: --x") || CSS.supports("position-anchor: --x"));
  }

  /** Bind observers, map chrome icons, load the menu, then layout. */
  connect() {
    if (!this.more || !this.list || !this.overflow || !this.hamburger || !this.drawer) {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.#schedule(() => this.layout(0));
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.list);

    this.compactMq = window.matchMedia(COMPACT_MQ);
    this.onCompactChange = () => {
      this.itemWidths = new WeakMap();
      this.#applyCompactMode();
      this.#schedule(() => this.layout(0));
    };
    this.compactMq.addEventListener("change", this.onCompactChange);

    this.onDocumentPointerDown = (event) => {
      this.#closeFlyoutsOutside(event.target);
    };
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    this.onWinResize = () => {
      this.#syncBarFlyouts();
    };
    window.addEventListener("resize", this.onWinResize);

    this.overflow.addEventListener("toggle", () => {
      this.#syncExpanded(this.more, this.overflow);
      this.#positionPanel(this.more, this.overflow);
      this.#constrainOverflowPanel();
      if (this.#isPanelOpen(this.overflow)) {
        this.#closeBarFlyouts();
      }
    });
    this.list.addEventListener("click", (event) => {
      const item = event.target instanceof Element ? event.target.closest(".snd-list-item") : null;
      if (!(item instanceof HTMLElement) || item.parentElement !== this.list) {
        return;
      }
      if (item.querySelector(":scope > .snd-submenu")) {
        return;
      }
      this.#closeBarFlyouts();
      this.#hidePanel(this.overflow);
      this.#syncExpanded(this.more, this.overflow);
    });
    this.drawer.addEventListener("toggle", () => {
      this.#syncExpanded(this.hamburger, this.drawer);
      this.#positionPanel(this.hamburger, this.drawer);
    });

    if (!this.supportsPopover) {
      this.more.addEventListener("click", () => {
        if (this.more.hidden) {
          return;
        }
        this.overflow.classList.toggle("is-open");
        this.#syncExpanded(this.more, this.overflow);
        this.#positionPanel(this.more, this.overflow);
        this.#constrainOverflowPanel();
        if (this.#isPanelOpen(this.overflow)) {
          this.#closeBarFlyouts();
        }
      });
      this.hamburger.addEventListener("click", () => {
        this.drawer.classList.toggle("is-open");
        this.#syncExpanded(this.hamburger, this.drawer);
        this.#positionPanel(this.hamburger, this.drawer);
      });
    }

    this.#mapChromeIcon(this.more, "morev");
    this.#mapChromeIcon(this.hamburger, "hamburger");
    onLanguageChange(() => {
      this.itemWidths = new WeakMap();
      this.#loadMenu().then(() => {
        this.#applyCompactMode();
        this.layout(0);
      });
    });
    this.#loadMenu().then(() => {
      this.#applyCompactMode();
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
    if (this.onDocumentPointerDown) {
      document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    }
    this.onDocumentPointerDown = null;
    if (this.onWinResize) {
      window.removeEventListener("resize", this.onWinResize);
    }
    this.onWinResize = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  /**
   * Show a fitting prefix of first-level items; hide the rest and toggle More.
   * @param {number} pass
   */
  layout(pass = 0) {
    if (this.#isCompact()) {
      this.more.toggleAttribute("hidden", true);
      this.#hidePanel(this.overflow);
      this.#syncExpanded(this.more, this.overflow);
      return;
    }

    const items = [...this.list.querySelectorAll(":scope > .snd-list-item")];

    if (!this.moreEnabled) {
      for (const item of items) {
        item.removeAttribute("hidden");
        item.classList.remove("is-overflow");
      }
      this.more.toggleAttribute("hidden", true);
      this.#hidePanel(this.overflow);
      this.#syncExpanded(this.more, this.overflow);
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

    const hasOverflow = visibleCount < items.length;
    const moreWasHidden = this.more.hidden;
    this.more.toggleAttribute("hidden", !hasOverflow);
    this.#syncOverflowPanel(items.slice(visibleCount));

    if (!hasOverflow) {
      this.#hidePanel(this.overflow);
    }

    this.#syncExpanded(this.more, this.overflow);

    if (moreWasHidden !== this.more.hidden && pass < MAX_LAYOUT_PASSES) {
      this.#schedule(() => this.layout(pass + 1));
    }
    this.#syncBarFlyouts();
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

  /** Fetch header-menu.json, the active language copy, and sprite.svg, then render the 3-level menu. */
  async #loadMenu() {
    const dataUrl = new URL("data/header-menu.json", import.meta.url);
    const copyUrl = new URL(`data/${languageFolder()}/header-menu.json`, import.meta.url);
    const spriteUrl = new URL("sprite.svg", import.meta.url);
    let data;
    let copy;
    let spriteXml;

    try {
      const [dataRes, copyRes, spriteRes] = await Promise.all([
        fetch(dataUrl),
        fetch(copyUrl),
        fetch(spriteUrl),
      ]);
      if (!dataRes.ok || !copyRes.ok || !spriteRes.ok) {
        return;
      }
      data = await dataRes.json();
      copy = await copyRes.json();
      spriteXml = await spriteRes.text();
    } catch {
      return;
    }

    const spriteDoc = new DOMParser().parseFromString(spriteXml, "image/svg+xml");
    this.symbolIds = new Set(
      [...spriteDoc.querySelectorAll("symbol[id]")].map((symbol) => symbol.id),
    );
    this.moreEnabled = data.moreList !== false;
    this.iconSize = Number.parseFloat(data.baseline) || 24;
    this.#applyListMaxWidth(data["max-width"]);
    this.#applyLanguage(data.menu, copy?.menu);

    const topLevel = this.#visibleArticles(data.menu);
    this.list.replaceChildren(
      ...topLevel.map((article) => this.#createItem(article, 1, false)),
    );
    this.drawer.replaceChildren(
      ...topLevel.map((article) => this.#createItem(article, 1, true)),
    );
  }

  /**
   * Cap .snd-list-ct when JSON max-width is a non-empty value.
   * @param {unknown} maxWidth
   */
  #applyListMaxWidth(maxWidth) {
    if (!(this.listCt instanceof HTMLElement)) {
      return;
    }
    const value = typeof maxWidth === "string" ? maxWidth.trim() : "";
    if (!value) {
      this.listCt.style.removeProperty("--snd-list-ct-max-width");
      return;
    }
    this.listCt.style.setProperty("--snd-list-ct-max-width", value);
  }

  /**
   * Sprite id from the structural menu. Language files may replace name with a translated word.
   * @param {object} article
   * @returns {string}
   */
  #spriteId(article) {
    const icon = typeof article.icon === "string" ? article.icon.trim() : "";
    if (icon) {
      return icon;
    }
    return typeof article.name === "string" ? article.name.trim() : "";
  }

  /**
   * Overlay translated name, label, description, and aria-label onto the structural menu.
   * @param {unknown} nodes
   * @param {unknown} copies
   */
  #applyLanguage(nodes, copies) {
    if (!Array.isArray(nodes) || !Array.isArray(copies)) {
      return;
    }
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const copy = copies[i];
      if (!node || typeof node !== "object" || !copy || typeof copy !== "object") {
        continue;
      }
      if (typeof node.name === "string") {
        node.icon = node.name;
      }
      for (const key of ["name", "label", "description", "aria-label"]) {
        if (typeof copy[key] === "string") {
          node[key] = copy[key];
        }
      }
      if (Array.isArray(node.items)) {
        this.#applyLanguage(node.items, copy.items);
      }
    }
  }

  /**
   * Keep articles that have a label or a known sprite id.
   * @param {unknown} articles
   * @returns {object[]}
   */
  #visibleArticles(articles) {
    if (!Array.isArray(articles)) {
      return [];
    }
    return articles.filter((article) => {
      if (!article || typeof article !== "object") {
        return false;
      }
      const name = this.#spriteId(article);
      const label = typeof article.label === "string" ? article.label.trim() : "";
      return Boolean(label) || this.symbolIds.has(name);
    });
  }

  /**
   * Put a sprite icon into a chrome control (More or hamburger).
   * @param {HTMLElement} host
   * @param {string} symbolId
   */
  #mapChromeIcon(host, symbolId) {
    host.replaceChildren(this.#createSvg(symbolId, 24, "snd-list-chrome-icon"));
  }

  /**
   * Build one menu article: icon, label, optional chevron, optional submenu.
   * @param {object} article
   * @param {number} level
   * @param {boolean} inDrawer
   * @returns {HTMLDivElement}
   */
  #createItem(article, level, inDrawer) {
    const item = document.createElement("div");
    item.className = "snd-list-item";
    item.dataset.level = String(level);

    const children =
      level < MAX_MENU_LEVEL ? this.#visibleArticles(article.items) : [];
    const hasChildren = children.length > 0;
    const name = this.#spriteId(article);
    const hasIcon = Boolean(name) && this.symbolIds.has(name);
    const control = document.createElement(hasChildren ? "button" : "a");
    control.className = "snd-list-link";
    if (name) {
      control.classList.add(`brand-${name}`);
    }
    if (hasChildren) {
      control.type = "button";
      control.setAttribute("aria-expanded", "false");
    } else {
      control.href = article.link || "#";
    }
    if (article.description) {
      control.title = article.description;
    }
    const ariaLabel = article["aria-label"] || article.description || article.label;
    if (ariaLabel) {
      control.setAttribute("aria-label", ariaLabel);
    }

    if (hasIcon) {
      const icon = this.#createSvg(name, this.iconSize, "snd-list-icon");
      const iconColor = typeof article.color === "string" ? article.color.trim() : "";
      if (iconColor) {
        icon.style.setProperty("--snd-icon-color", iconColor);
      }
      control.append(icon);
    }

    const label = document.createElement("span");
    label.className = "snd-list-label";
    label.append(document.createTextNode(article.label ?? ""));
    control.append(label);

    if (hasChildren) {
      const chevronId = inDrawer ? "chevron-right" : "chevron-down";
      control.append(this.#createSvg(chevronId, 16, "snd-list-chevron"));
      control.addEventListener("click", (event) => {
        event.preventDefault();
        this.#toggleItem(item, control, inDrawer);
      });
    }

    item.append(control);

    if (hasChildren) {
      const submenu = document.createElement("div");
      submenu.className = "snd-submenu";
      submenu.append(
        ...children.map((child) => this.#createItem(child, level + 1, inDrawer)),
      );
      item.append(submenu);
    }

    return item;
  }

  /**
   * Open or close a branch. First-level bar panels are exclusive of each other and More.
   * @param {HTMLElement} item
   * @param {HTMLElement} control
   * @param {boolean} _inDrawer
   */
  #toggleItem(item, control, _inDrawer) {
    const open = !item.classList.contains("is-open");
    if (open && item.parentElement === this.list) {
      this.#closeBarFlyouts(item);
      this.#hidePanel(this.overflow);
      this.#syncExpanded(this.more, this.overflow);
    }
    this.#setItemOpen(item, open);
    control.setAttribute("aria-expanded", String(open));
  }

  /**
   * Close first-level bar flyouts, optionally keeping one open.
   * @param {Element | null} [keepItem]
   */
  #closeBarFlyouts(keepItem = null) {
    for (const item of [...this.list.querySelectorAll(":scope > .snd-list-item.is-open")]) {
      if (item !== keepItem) {
        this.#setItemOpen(item, false);
      }
    }
  }

  /**
   * Whether a popover panel is currently shown.
   * @param {HTMLElement} panel
   * @returns {boolean}
   */
  #isPanelOpen(panel) {
    return this.supportsPopover
      ? panel.matches(":popover-open")
      : panel.classList.contains("is-open");
  }

  /**
   * Set a branch open state, animate its submenu, and collapse nested branches when closing.
   * @param {Element} item
   * @param {boolean} open
   */
  #setItemOpen(item, open) {
    const wasOpen = item.classList.contains("is-open");
    if (wasOpen === open) {
      return;
    }
    item.classList.toggle("is-open", open);
    item
      .querySelector(":scope > .snd-list-link[aria-expanded]")
      ?.setAttribute("aria-expanded", String(open));
    const submenu = item.querySelector(":scope > .snd-submenu");
    if (submenu) {
      this.#animateSubmenu(submenu, open);
    }
    const chevron = item.querySelector(":scope > .snd-list-link .snd-list-chevron");
    if (chevron) {
      this.#animateChevron(chevron, open, item.closest(".snd-menu-drawer") !== null);
    }
    if (!open) {
      item.querySelector(":scope > .snd-list-link")?.blur();
      for (const nested of item.querySelectorAll(":scope > .snd-submenu .snd-list-item.is-open")) {
        nested.classList.remove("is-open");
        nested
          .querySelector(":scope > .snd-list-link[aria-expanded]")
          ?.setAttribute("aria-expanded", "false");
        const nestedSub = nested.querySelector(":scope > .snd-submenu");
        if (nestedSub) {
          this.#finishSubmenu(nestedSub, false);
        }
        const nestedChevron = nested.querySelector(":scope > .snd-list-link .snd-list-chevron");
        if (nestedChevron) {
          nestedChevron.style.transform = "";
        }
      }
    }
  }

  /**
   * Expand or collapse a submenu height with requestAnimationFrame.
   * @param {HTMLElement} submenu
   * @param {boolean} open
   */
  #animateSubmenu(submenu, open) {
    const running = this.submenuAnims.get(submenu);
    if (running) {
      cancelAnimationFrame(running);
      this.submenuAnims.delete(submenu);
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      this.#finishSubmenu(submenu, open);
      return;
    }

    const duration = 220;
    let from = 0;
    let to = 0;

    if (open) {
      submenu.style.display = "flex";
      this.#constrainBarFlyout(submenu);
      submenu.style.overflow = "hidden";
      submenu.style.height = "auto";
      const max = this.#flyoutMaxHeight(submenu);
      to = max > 0 ? Math.min(submenu.scrollHeight, max) : submenu.scrollHeight;
      from = 0;
      submenu.style.height = "0px";
    } else {
      submenu.style.display = "flex";
      submenu.style.overflow = "hidden";
      from = submenu.getBoundingClientRect().height;
      to = 0;
      submenu.style.height = `${from}px`;
    }

    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      submenu.style.height = `${from + (to - from) * eased}px`;
      if (t < 1) {
        this.submenuAnims.set(submenu, requestAnimationFrame(step));
        return;
      }
      this.submenuAnims.delete(submenu);
      this.#finishSubmenu(submenu, open);
    };
    this.submenuAnims.set(submenu, requestAnimationFrame(step));
  }

  /**
   * Rotate the chevron in sync with submenu open state.
   * @param {SVGElement} chevron
   * @param {boolean} open
   * @param {boolean} inDrawer
   */
  #animateChevron(chevron, open, inDrawer) {
    const end = open ? (inDrawer ? 90 : 180) : 0;
    chevron.style.transform = `rotate(${end}deg)`;
  }

  /**
   * Settle submenu styles after an open or close animation.
   * @param {HTMLElement} submenu
   * @param {boolean} open
   */
  #finishSubmenu(submenu, open) {
    const running = this.submenuAnims.get(submenu);
    if (running) {
      cancelAnimationFrame(running);
      this.submenuAnims.delete(submenu);
    }
    if (open) {
      submenu.style.display = "flex";
      submenu.style.height = "auto";
      if (this.#isBarFlyout(submenu)) {
        this.#constrainBarFlyout(submenu);
        submenu.style.overflow = "auto";
      } else {
        submenu.style.overflow = "visible";
      }
    } else {
      submenu.style.display = "none";
      submenu.style.height = "";
      submenu.style.overflow = "";
      submenu.style.maxHeight = "";
    }
  }

  /**
   * True when the submenu is a first-level flyout on the bar.
   * @param {HTMLElement} submenu
   * @returns {boolean}
   */
  #isBarFlyout(submenu) {
    return submenu.parentElement?.parentElement === this.list;
  }

  /**
   * Viewport space from the flyout top to the bottom of the window.
   * @param {HTMLElement} submenu
   * @returns {number}
   */
  #flyoutMaxHeight(submenu) {
    if (!this.#isBarFlyout(submenu)) {
      return 0;
    }
    const item = submenu.parentElement;
    if (!(item instanceof HTMLElement)) {
      return 0;
    }
    return Math.max(0, window.innerHeight - item.getBoundingClientRect().bottom);
  }

  /**
   * Cap a bar flyout so its bottom stays at the viewport bottom.
   * @param {HTMLElement} submenu
   */
  #constrainBarFlyout(submenu) {
    if (!this.#isBarFlyout(submenu)) {
      return;
    }
    submenu.style.maxHeight = `${this.#flyoutMaxHeight(submenu)}px`;
  }

  /** Recompute max-height for every open bar flyout and the More panel. */
  #syncBarFlyouts() {
    for (const item of this.list.querySelectorAll(":scope > .snd-list-item.is-open")) {
      const submenu = item.querySelector(":scope > .snd-submenu");
      if (submenu instanceof HTMLElement) {
        this.#constrainBarFlyout(submenu);
      }
    }
    this.#constrainOverflowPanel();
  }

  /**
   * Cap the More popover so its bottom stays at the viewport bottom.
   */
  #constrainOverflowPanel() {
    const open = this.supportsPopover
      ? this.overflow.matches(":popover-open")
      : this.overflow.classList.contains("is-open");
    if (!open) {
      this.overflow.style.maxHeight = "";
      return;
    }
    const top = this.more.getBoundingClientRect().bottom + 4;
    this.overflow.style.maxHeight = `${Math.max(0, window.innerHeight - top)}px`;
  }

  /**
   * Close open branches only when the pointer is outside the component.
   * @param {EventTarget | null} target
   */
  #closeFlyoutsOutside(target) {
    if (!(target instanceof Node) || this.root.contains(target)) {
      return;
    }
    for (const item of [...this.root.querySelectorAll(".snd-list-item.is-open")]) {
      this.#setItemOpen(item, false);
    }
  }

  /**
   * Create an SVG that references a sprite symbol.
   * @param {string} symbolId
   * @param {number} size
   * @param {string} className
   * @returns {SVGSVGElement}
   */
  #createSvg(symbolId, size, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.classList.add(className);
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `sprite.svg#${symbolId}`);
    svg.append(use);
    return svg;
  }

  /** Swap the bar for the hamburger on mobile portrait. */
  #applyCompactMode() {
    const compact = this.#isCompact();
    this.root.classList.toggle("is-compact", compact);
    if (!compact) {
      this.#hidePanel(this.drawer);
      this.#syncExpanded(this.hamburger, this.drawer);
    }
  }

  /** @returns {boolean} */
  #isCompact() {
    return Boolean(this.compactMq?.matches);
  }

  /**
   * Clone overflowed first-level items into the More popover.
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
        clone.querySelectorAll(".is-open").forEach((el) => {
          el.classList.remove("is-open");
        });
        clone.querySelectorAll("[aria-expanded]").forEach((el) => {
          el.setAttribute("aria-expanded", "false");
        });
        this.#bindClonedToggles(clone, false);
        return clone;
      }),
    );
  }

  /**
   * Re-bind expand clicks on cloned overflow items, including the cloned root.
   * @param {HTMLElement} root
   * @param {boolean} inDrawer
   */
  #bindClonedToggles(root, inDrawer) {
    const items = [
      ...(root.matches(".snd-list-item") ? [root] : []),
      ...root.querySelectorAll(".snd-list-item"),
    ];
    for (const item of items) {
      const control = item.querySelector(":scope > .snd-list-link[aria-expanded]");
      if (!control) {
        continue;
      }
      control.addEventListener("click", (event) => {
        event.preventDefault();
        this.#toggleItem(item, control, inDrawer);
      });
    }
  }

  /**
   * Close a popover panel.
   * @param {HTMLElement} panel
   */
  #hidePanel(panel) {
    if (this.supportsPopover && panel.matches(":popover-open")) {
      panel.hidePopover();
    }
    panel.classList.remove("is-open");
  }

  /**
   * Keep aria-expanded in sync with a panel's open state.
   * @param {HTMLElement} trigger
   * @param {HTMLElement} panel
   */
  #syncExpanded(trigger, panel) {
    const open = this.supportsPopover
      ? panel.matches(":popover-open")
      : panel.classList.contains("is-open");
    trigger.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /**
   * Place a popover under its trigger (native popovers live in the top layer).
   * @param {HTMLElement} trigger
   * @param {HTMLElement} panel
   */
  #positionPanel(trigger, panel) {
    const open = this.supportsPopover
      ? panel.matches(":popover-open")
      : panel.classList.contains("is-open");
    if (!open || this.supportsAnchor) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    panel.style.position = "fixed";
    panel.style.inset = "auto";
    panel.style.top = `${rect.bottom + 4}px`;
    if (panel === this.drawer) {
      panel.style.left = "0";
      panel.style.right = "0";
      panel.style.margin = "0 auto";
      panel.style.width = "fit-content";
      panel.style.bottom = "0px";
      panel.style.height = "auto";
    } else {
      panel.style.margin = "0";
      panel.style.left = `${rect.left}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      if (panel === this.overflow) {
        panel.style.maxHeight = `${Math.max(0, window.innerHeight - (rect.bottom + 4))}px`;
      }
    }
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

document.querySelectorAll(".snd-ct-menu .snd-list-comp").forEach((root) => {
  new SndListComp(root).connect();
});
