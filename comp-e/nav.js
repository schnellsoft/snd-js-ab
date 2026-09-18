import { Deck } from "./card.js";

const SERVICES_URL = new URL("./services.json", import.meta.url);
const RECOMMENDED_VALUE = "recommended";
const RECOMMENDED_LABEL = "Recommended Services";
const MAX_SUGGESTIONS = 12;

export class Nav {
  constructor() {
    /** @type {{ recommended?: Array<Service>, recommend?: Array<Service>, categories?: Array<Category> }} */
    this.OBServices = { recommended: [], categories: [] };
    /** @type {Array<Service>} */
    this.nav_serv_vec = [];
    /** @type {Array<NavGroup>} */
    this.groups = [];
    this.catalogActive = true;
    this.syncingCombos = false;
    /** @type {Deck | null} */
    this.deck = null;
    /** @type {HTMLElement | null} */
    this.main = null;
    this.windowStart = 0;
    this.perRow = 1;
    /** @type {ResizeObserver | null} */
    this.resizeObserver = null;
    /** @type {HTMLSelectElement | null} */
    this.categorySelect = null;
    /** @type {HTMLSelectElement | null} */
    this.subcategorySelect = null;
    /** @type {HTMLFormElement | null} */
    this.searchForm = null;
    /** @type {HTMLInputElement | null} */
    this.searchInput = null;
    /** @type {HTMLElement | null} */
    this.searchPanel = null;
    /** @type {HTMLElement | null} */
    this.positionEl = null;
    /** @type {Array<Service>} */
    this.searchHits = [];
    this.activeOption = -1;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  async connect() {
    this.categorySelect = document.querySelector("#ct-combo-category");
    this.subcategorySelect = document.querySelector("#ct-combo-subcategory");
    this.searchForm = document.querySelector(".ct-search");
    this.searchInput = document.querySelector("#ct-search-input");
    this.searchPanel = document.querySelector("#ct-search-list");
    this.positionEl = document.querySelector("#ct-nav-position");

    this.OBServices = await this.#loadServices();
    this.#buildGroups();
    this.#fillCategories();
    this.catalogActive = true;
    this.windowStart = 0;
    this.#setNavServices(this.#catalogServices());

    this.main = document.querySelector(".ct-card-all-main");
    if (this.main instanceof HTMLElement) {
      this.deck = new Deck(this.main, {
        onStep: (step, alreadyFlipped) => this.#pageStep(step, alreadyFlipped),
      });
      this.deck.connect();
    }

    this.resizeObserver = new ResizeObserver(() => this.#onMainResize());
    if (this.main) {
      this.resizeObserver.observe(this.main);
    }

    this.#paintWindow();
    this.#syncCombos(this.groups[0]);
    this.#syncPosition(this.windowStart);

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.categorySelect?.addEventListener("change", () => this.#onCategoryChange(), { signal });
    this.categorySelect?.addEventListener("input", () => this.#onCategoryChange(), { signal });
    this.categorySelect?.addEventListener("click", (event) => this.#onComboActivate(event, "category"), { signal });
    this.subcategorySelect?.addEventListener("change", () => this.#onSubcategoryChange(), { signal });
    this.subcategorySelect?.addEventListener("input", () => this.#onSubcategoryChange(), { signal });
    this.subcategorySelect?.addEventListener("click", (event) => this.#onComboActivate(event, "subcategory"), { signal });
    this.searchForm?.addEventListener("submit", (event) => this.#onSearchSubmit(event), { signal });
    this.searchInput?.addEventListener("input", () => this.#onSearchInput(), { signal });
    this.searchInput?.addEventListener("keydown", (event) => this.#onSearchKey(event), { signal });
    this.searchPanel?.addEventListener(
      "mousedown",
      (event) => {
        event.preventDefault();
        this.#onSuggestionClick(event);
      },
      { signal },
    );
    document.addEventListener("pointerdown", (event) => this.#onPointerDown(event), { signal });
  }

  disconnect() {
    this.controller?.abort();
    this.controller = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.deck?.disconnect();
    this.deck = null;
    this.#closePanel();
  }

  async #loadServices() {
    try {
      const response = await fetch(SERVICES_URL);
      if (!response.ok) {
        return { recommended: [], categories: [] };
      }
      return await response.json();
    } catch {
      return { recommended: [], categories: [] };
    }
  }

  /** @returns {Array<Service>} */
  #recommended() {
    return this.OBServices.recommended ?? this.OBServices.recommend ?? [];
  }

  #fillCategories() {
    const select = this.categorySelect;
    if (!select) {
      return;
    }

    select.replaceChildren();

    const recommended = document.createElement("option");
    recommended.value = RECOMMENDED_VALUE;
    recommended.textContent = RECOMMENDED_LABEL;
    recommended.selected = true;
    select.append(recommended);

    for (const category of this.OBServices.categories ?? []) {
      const option = document.createElement("option");
      option.value = category.name;
      option.textContent = category.name;
      select.append(option);
    }

    select.value = RECOMMENDED_VALUE;
  }

  /**
   * @param {Array<Subcategory>} subcategories
   * @param {string} [selected]
   */
  #fillSubcategories(subcategories, selected = "") {
    const select = this.subcategorySelect;
    if (!select) {
      return;
    }

    select.replaceChildren();

    if (!subcategories.length) {
      const empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "";
      empty.selected = true;
      select.append(empty);
      select.value = "";
      return;
    }

    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "";
    select.append(empty);

    for (const subcategory of subcategories) {
      const option = document.createElement("option");
      option.value = subcategory.name;
      option.textContent = subcategory.name;
      select.append(option);
    }

    select.value = selected;
  }

  #onCategoryChange() {
    if (this.syncingCombos) {
      return;
    }

    this.#jumpToCategory(this.categorySelect?.value ?? RECOMMENDED_VALUE);
  }

  #onSubcategoryChange() {
    if (this.syncingCombos) {
      return;
    }

    const categoryValue = this.categorySelect?.value ?? "";
    if (categoryValue === RECOMMENDED_VALUE) {
      this.#jumpToCategory(RECOMMENDED_VALUE);
      return;
    }

    const subcategoryName = this.subcategorySelect?.value ?? "";
    const start = this.#groupStart(categoryValue, subcategoryName);
    if (start >= 0) {
      this.#ensureCatalog(start);
      return;
    }

    this.#jumpToCategory(categoryValue);
  }

  /**
   * @param {MouseEvent} event
   * @param {"category" | "subcategory"} which
   */
  #onComboActivate(event, which) {
    if (this.syncingCombos) {
      return;
    }

    if (event.target instanceof HTMLOptionElement) {
      if (which === "category") {
        this.#jumpToCategory(event.target.value);
      } else {
        this.#onSubcategoryChange();
      }
    }
  }

  /**
   * @param {Event} event
   */
  #onSearchSubmit(event) {
    event.preventDefault();
    const query = this.searchInput?.value ?? "";
    const matches = this.#filterServices(query);
    this.searchHits = matches;
    this.#closePanel();
    if (matches.length) {
      this.catalogActive = false;
      this.#setNavServices(matches);
    }
  }

  #onSearchInput() {
    const query = this.searchInput?.value ?? "";
    if (!query.trim()) {
      this.searchHits = [];
      this.#closePanel();
      return;
    }

    this.searchHits = this.#filterServices(query);
    this.activeOption = this.searchHits.length ? 0 : -1;
    this.#renderPanel();
  }

  /**
   * @param {KeyboardEvent} event
   */
  #onSearchKey(event) {
    const open = this.searchPanel && !this.searchPanel.hasAttribute("hidden");
    const count = Math.min(this.searchHits.length, MAX_SUGGESTIONS);

    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        this.#closePanel();
      }
      return;
    }

    if (event.key === "ArrowDown" && count) {
      event.preventDefault();
      if (!open) {
        this.#renderPanel();
      }
      this.activeOption = (this.activeOption + 1 + count) % count;
      this.#syncActiveOption();
      return;
    }

    if (event.key === "ArrowUp" && count) {
      event.preventDefault();
      if (!open) {
        this.#renderPanel();
      }
      this.activeOption = (this.activeOption - 1 + count) % count;
      this.#syncActiveOption();
      return;
    }

    if (event.key === "Enter" && open && this.activeOption >= 0) {
      event.preventDefault();
      this.#chooseSuggestion(this.activeOption);
    }
  }

  /**
   * @param {MouseEvent} event
   */
  #onSuggestionClick(event) {
    const option = event.target instanceof Element ? event.target.closest("[data-search-index]") : null;
    if (!option) {
      return;
    }
    this.#chooseSuggestion(Number(option.getAttribute("data-search-index")));
  }

  /**
   * @param {PointerEvent} event
   */
  #onPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (this.searchForm?.contains(target) || this.searchPanel?.contains(target)) {
      return;
    }
    this.#closePanel();
  }

  /**
   * @param {number} index
   */
  #chooseSuggestion(index) {
    const chosen = this.searchHits[index];
    if (!chosen || !this.searchInput) {
      return;
    }

    this.searchInput.value = chosen.name;
    const catalogIndex = this.#catalogIndexOf(chosen);
    this.#closePanel();
    if (catalogIndex >= 0) {
      this.#ensureCatalog(catalogIndex);
      return;
    }

    const rest = this.searchHits.filter((_, itemIndex) => itemIndex !== index);
    this.catalogActive = false;
    this.#setNavServices([chosen, ...rest]);
  }

  #renderPanel() {
    const panel = this.searchPanel;
    const input = this.searchInput;
    if (!panel || !input) {
      return;
    }

    panel.replaceChildren();
    const visible = this.searchHits.slice(0, MAX_SUGGESTIONS);

    if (!visible.length) {
      const empty = document.createElement("li");
      empty.className = "ct-search-empty";
      empty.textContent = "No matching services";
      panel.append(empty);
      panel.removeAttribute("hidden");
      input.setAttribute("aria-expanded", "true");
      input.removeAttribute("aria-activedescendant");
      return;
    }

    visible.forEach((service, index) => {
      const option = document.createElement("li");
      option.id = `ct-search-opt-${index}`;
      option.className = "ct-search-option";
      option.setAttribute("role", "option");
      option.setAttribute("data-search-index", String(index));
      option.setAttribute("aria-selected", index === this.activeOption ? "true" : "false");
      option.setAttribute("aria-label", `${service.name}, ${this.#formatPrice(service)}`);

      const name = document.createElement("span");
      name.className = "ct-search-option-name";
      name.textContent = service.name;

      const price = document.createElement("span");
      price.className = "ct-search-option-price";
      price.textContent = this.#formatPrice(service);

      option.append(name, price);
      panel.append(option);
    });

    panel.removeAttribute("hidden");
    input.setAttribute("aria-expanded", "true");
    this.#syncActiveOption();
  }

  #syncActiveOption() {
    const panel = this.searchPanel;
    const input = this.searchInput;
    if (!panel || !input) {
      return;
    }

    const options = [...panel.querySelectorAll("[data-search-index]")];
    options.forEach((option, index) => {
      const selected = index === this.activeOption;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  #closePanel() {
    this.activeOption = -1;
    this.searchPanel?.replaceChildren();
    this.searchPanel?.setAttribute("hidden", "");
    this.searchInput?.setAttribute("aria-expanded", "false");
    this.searchInput?.removeAttribute("aria-activedescendant");
  }

  /**
   * @param {string} name
   * @returns {Category | undefined}
   */
  #findCategory(name) {
    return (this.OBServices.categories ?? []).find((category) => category.name === name);
  }

  #buildGroups() {
    /** @type {Array<NavGroup>} */
    const groups = [];
    let start = 0;

    /**
     * @param {string} category
     * @param {string} subcategory
     * @param {Array<Service>} services
     */
    const push = (category, subcategory, services) => {
      if (!services.length) {
        return;
      }
      groups.push({ category, subcategory, start, services });
      start += services.length;
    };

    push(RECOMMENDED_VALUE, "", this.#recommended());
    for (const category of this.OBServices.categories ?? []) {
      push(category.name, "", category.services ?? []);
      for (const subcategory of category.subcategories ?? []) {
        push(category.name, subcategory.name, subcategory.services ?? []);
      }
    }

    this.groups = groups;
  }

  /** @returns {Array<Service>} */
  #catalogServices() {
    return this.groups.flatMap((group) => group.services);
  }

  /**
   * @param {number} index
   */
  #syncPosition(index) {
    if (!this.positionEl) {
      return;
    }

    const slice = this.#sliceAt(index);
    const count = slice.items.length;

    if (!this.catalogActive) {
      const total = this.nav_serv_vec.length;
      const current = total && count ? index + 1 : 0;
      const last = current && count ? current + count - 1 : 0;
      this.positionEl.textContent = count > 1 ? `${current}–${last} of ${total}` : `${current} of ${total}`;
      return;
    }

    const group = this.#groupAt(index);
    if (!group) {
      this.positionEl.textContent = "0 of 0";
      return;
    }

    const categoryGroups = this.groups.filter((item) => item.category === group.category);
    const start = categoryGroups[0]?.start ?? group.start;
    const total = categoryGroups.reduce((sum, item) => sum + item.services.length, 0);
    const current = total && count ? index - start + 1 : 0;
    const last = current && count ? current + count - 1 : 0;
    this.positionEl.textContent = count > 1 ? `${current}–${last} of ${total}` : `${current} of ${total}`;
  }

  /**
   * @param {number} index
   * @returns {NavGroup | undefined}
   */
  #groupAt(index) {
    return this.groups.find((group) => index >= group.start && index < group.start + group.services.length);
  }

  /**
   * @param {string} category
   * @param {string} subcategory
   */
  #groupStart(category, subcategory) {
    const group = this.groups.find((item) => item.category === category && item.subcategory === subcategory);
    return group ? group.start : -1;
  }

  /**
   * @param {Service} service
   */
  #catalogIndexOf(service) {
    return this.#catalogServices().findIndex(
      (item) => item.name === service.name && item.price === service.price && item.currency === service.currency,
    );
  }

  /**
   * @param {string} value
   */
  #jumpToCategory(value) {
    if (value === RECOMMENDED_VALUE) {
      this.#ensureCatalog(this.#groupStart(RECOMMENDED_VALUE, ""));
      return;
    }

    const category = this.#findCategory(value);
    const subcategories = category?.subcategories ?? [];
    const subcategory = subcategories[0]?.name ?? "";
    const start = this.#groupStart(value, subcategory);
    this.#ensureCatalog(start >= 0 ? start : 0);
  }

  /**
   * @param {number} index
   */
  #ensureCatalog(index) {
    const catalog = this.#catalogServices();
    this.catalogActive = true;
    this.nav_serv_vec = catalog;
    const safeIndex = catalog.length ? Math.min(Math.max(0, index), catalog.length - 1) : 0;
    this.windowStart = this.#alignStart(safeIndex);
    this.#paintWindow();
    this.#syncCombos(this.#groupAt(this.windowStart));
    this.#syncPosition(this.windowStart);
  }

  /**
   * @param {NavGroup | undefined} group
   */
  #syncCombos(group) {
    if (!group || !this.categorySelect || !this.subcategorySelect) {
      return;
    }

    this.syncingCombos = true;
    this.categorySelect.value = group.category;
    const subcategories =
      group.category === RECOMMENDED_VALUE ? [] : (this.#findCategory(group.category)?.subcategories ?? []);
    this.#fillSubcategories(subcategories, group.subcategory);
    this.syncingCombos = false;
  }

  /**
   * @param {Array<Service>} services
   * @param {number} [index]
   */
  #setNavServices(services, index = 0) {
    this.nav_serv_vec = services.slice();
    this.windowStart = this.#alignStart(index);
    this.#paintWindow();
  }

  #onMainResize() {
    const next = this.#measurePerRow();
    if (next === this.perRow && this.deck) {
      return;
    }
    this.perRow = next;
    this.windowStart = this.#alignStart(this.windowStart);
    this.#paintWindow();
    this.#syncPosition(this.windowStart);
  }

  /** @returns {number} */
  #measurePerRow() {
    const main = this.main;
    if (!main) {
      return 1;
    }
    const styles = getComputedStyle(main);
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 16;
    const width = main.clientWidth;
    const minCard = Number.parseFloat(styles.getPropertyValue("--ct-card-min-px")) || 240;
    if (width <= 0) {
      return 1;
    }
    return Math.max(1, Math.floor((width + gap) / (minCard + gap)));
  }

  /**
   * @param {number} index
   */
  #alignStart(index) {
    const total = this.nav_serv_vec.length;
    if (!total) {
      return 0;
    }
    const safe = Math.min(Math.max(0, index), total - 1);
    const perRow = Math.max(1, this.perRow);

    if (!this.catalogActive) {
      return Math.floor(safe / perRow) * perRow;
    }

    const group = this.#groupAt(safe);
    if (!group) {
      return safe;
    }
    const local = safe - group.start;
    return group.start + Math.floor(local / perRow) * perRow;
  }

  /**
   * @param {number} start
   */
  #sliceAt(start) {
    const list = this.nav_serv_vec;
    const perRow = Math.max(1, this.perRow);
    if (!list.length) {
      return { start: 0, items: [] };
    }

    if (!this.catalogActive) {
      const aligned = Math.min(Math.max(0, start), list.length - 1);
      const count = Math.min(perRow, list.length - aligned);
      return { start: aligned, items: list.slice(aligned, aligned + count) };
    }

    const group = this.#groupAt(start) ?? this.groups[0];
    if (!group) {
      return { start: 0, items: [] };
    }
    const localStart = Math.min(Math.max(start, group.start), group.start + group.services.length - 1);
    const remaining = group.start + group.services.length - localStart;
    const count = Math.min(perRow, remaining);
    return { start: localStart, items: list.slice(localStart, localStart + count) };
  }

  /**
   * @param {number} step
   */
  #adjacentStart(step) {
    const perRow = Math.max(1, this.perRow);
    const list = this.nav_serv_vec;
    if (!list.length) {
      return 0;
    }

    if (!this.catalogActive) {
      if (step > 0) {
        const next = this.windowStart + this.#sliceAt(this.windowStart).items.length;
        return next >= list.length ? 0 : next;
      }
      if (this.windowStart > 0) {
        return Math.max(0, this.windowStart - perRow);
      }
      const rem = list.length % perRow;
      return list.length - (rem || perRow);
    }

    const group = this.#groupAt(this.windowStart);
    if (!group) {
      return 0;
    }
    const groupEnd = group.start + group.services.length;
    const count = this.#sliceAt(this.windowStart).items.length;

    if (step > 0) {
      const next = this.windowStart + count;
      if (next < groupEnd) {
        return next;
      }
      const index = this.groups.indexOf(group);
      const nextGroup = this.groups[(index + 1) % this.groups.length];
      return nextGroup?.start ?? 0;
    }

    if (this.windowStart > group.start) {
      return Math.max(group.start, this.windowStart - perRow);
    }

    const index = this.groups.indexOf(group);
    const prevGroup = this.groups[(index - 1 + this.groups.length) % this.groups.length];
    return this.#lastPageStart(prevGroup);
  }

  /**
   * @param {NavGroup | undefined} group
   */
  #lastPageStart(group) {
    if (!group) {
      return 0;
    }
    const perRow = Math.max(1, this.perRow);
    const len = group.services.length;
    if (len <= perRow) {
      return group.start;
    }
    const rem = len % perRow;
    return group.start + len - (rem || perRow);
  }

  /**
   * @param {number} step
   * @param {boolean} [alreadyFlipped]
   */
  #pageStep(step, alreadyFlipped = false) {
    if (!this.deck || this.nav_serv_vec.length < 1) {
      return;
    }
    if (!alreadyFlipped && this.deck.busy) {
      return;
    }

    const nextStart = this.#adjacentStart(step);
    if (nextStart === this.windowStart) {
      return;
    }

    const nextSlice = this.#sliceAt(nextStart);
    const commit = () => {
      this.windowStart = nextStart;
      this.#paintWindow();
      if (this.catalogActive) {
        this.#syncCombos(this.#groupAt(this.windowStart));
      }
      this.#syncPosition(this.windowStart);
    };

    if (alreadyFlipped) {
      commit();
      return;
    }

    this.deck.flip(step, this.#toCardItems(nextSlice.items), commit);
  }

  #paintWindow() {
    if (!this.deck) {
      return;
    }
    this.perRow = this.#measurePerRow();
    const current = this.#sliceAt(this.windowStart);
    this.windowStart = current.start;
    const next = this.#sliceAt(this.#adjacentStart(1));
    const prev = this.#sliceAt(this.#adjacentStart(-1));
    this.deck.setWindow(this.#toCardItems(current.items), this.#toCardItems(next.items), this.#toCardItems(prev.items));
  }

  /**
   * @param {Array<Service>} services
   */
  #toCardItems(services) {
    return services.map((service) => this.#toCardItem(service));
  }

  /**
   * @param {Service} service
   */
  #toCardItem(service) {
    return {
      title: service.name,
      price: this.#formatPrice(service),
      icon: "icon-generic",
    };
  }

  /**
   * @param {Service} service
   */
  #formatPrice(service) {
    return `${service.price} ${service.currency}`;
  }

  /**
   * @param {string} query
   * @returns {Array<Service>}
   */
  #filterServices(query) {
    const needle = this.#normalize(query);
    if (!needle) {
      return [];
    }

    return this.#allServices().filter((service) => this.#normalize(service.name).includes(needle));
  }

  /** @returns {Array<Service>} */
  #allServices() {
    /** @type {Array<Service>} */
    const list = [];
    const seen = new Set();

    /**
     * @param {Service} service
     */
    const add = (service) => {
      if (!service?.name) {
        return;
      }
      const key = `${service.name}|${service.price}|${service.currency}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      list.push(service);
    };

    for (const service of this.#recommended()) {
      add(service);
    }

    for (const category of this.OBServices.categories ?? []) {
      for (const service of category.services ?? []) {
        add(service);
      }
      for (const subcategory of category.subcategories ?? []) {
        for (const service of subcategory.services ?? []) {
          add(service);
        }
      }
    }

    return list;
  }

  /**
   * @param {string} text
   */
  #normalize(text) {
    return String(text)
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .trim();
  }
}

export const nav = new Nav();

/**
 * @typedef {{ name: string, price: number, currency: string }} Service
 * @typedef {{ name: string, services?: Array<Service> }} Subcategory
 * @typedef {{ name: string, services?: Array<Service>, subcategories?: Array<Subcategory> }} Category
 * @typedef {{ category: string, subcategory: string, start: number, services: Array<Service> }} NavGroup
 */
