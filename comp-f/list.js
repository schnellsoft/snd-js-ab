const SERVICES_URL = new URL("./services.json", import.meta.url);
const RECOMMENDED_VALUE = "recommended";
const RECOMMENDED_LABEL = "Recommended Services";
const MAX_SUGGESTIONS = 12;

/**
 * @typedef {{ name: string, price: number | string, currency?: string }} Service
 * @typedef {{ name: string, services?: Service[] }} Subcategory
 * @typedef {{ name: string, services?: Service[], subcategories?: Subcategory[] }} Category
 */

export class ServiceList {
  constructor() {
    /** @type {{ recommended?: Service[], recommend?: Service[], categories?: Category[] }} */
    this.data = { recommended: [], categories: [] };
    /** @type {HTMLElement | null} */
    this.main = null;
    /** @type {HTMLElement | null} */
    this.root = null;
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
    this.activeOption = -1;
    this.syncing = false;
    this.totalCount = 0;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  async connect() {
    this.main = document.querySelector(".ct-card-all-main");
    this.root = document.querySelector("#ct-serv-list");
    this.categorySelect = document.querySelector("#ct-combo-category");
    this.subcategorySelect = document.querySelector("#ct-combo-subcategory");
    this.searchForm = document.querySelector(".ct-search");
    this.searchInput = document.querySelector("#ct-search-input");
    this.searchPanel = document.querySelector("#ct-search-list");
    this.positionEl = document.querySelector("#ct-nav-position");

    if (!(this.root instanceof HTMLElement) || !(this.main instanceof HTMLElement)) {
      return;
    }

    this.data = await this.#load();
    this.#render();
    this.#fillCategories();
    this.#fillSubcategories(RECOMMENDED_VALUE);
    this.#syncPosition();

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.categorySelect?.addEventListener("change", () => this.#onCategoryChange(), { signal });
    this.subcategorySelect?.addEventListener("change", () => this.#onSubcategoryChange(), { signal });
    this.searchForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.#applyQuery(this.searchInput?.value ?? "");
      this.#hidePanel();
    }, { signal });
    this.searchInput?.addEventListener("input", () => this.#onSearchInput(), { signal });
    this.searchInput?.addEventListener("keydown", (event) => this.#onSearchKey(event), { signal });
    this.searchPanel?.addEventListener("mousedown", (event) => this.#onSuggestionClick(event), { signal });
    document.querySelector(".left-button")?.addEventListener("click", () => this.#stepCategory(-1), { signal });
    document.querySelector(".right-button")?.addEventListener("click", () => this.#stepCategory(1), { signal });
    document.addEventListener("click", (event) => {
      if (event.target instanceof Element && !event.target.closest(".ct-card-all-search")) {
        this.#hidePanel();
      }
    }, { signal });
  }

  /**
   * @returns {Promise<{ recommended?: Service[], recommend?: Service[], categories?: Category[] }>}
   */
  async #load() {
    try {
      const response = await fetch(SERVICES_URL);
      if (!response.ok) {
        return { recommended: [], categories: [] };
      }
      const data = await response.json();
      return data && typeof data === "object" ? data : { recommended: [], categories: [] };
    } catch {
      return { recommended: [], categories: [] };
    }
  }

  #recommended() {
    return this.data.recommended ?? this.data.recommend ?? [];
  }

  #categories() {
    return this.data.categories ?? [];
  }

  #render() {
    if (!this.root) {
      return;
    }

    this.root.replaceChildren();
    this.totalCount = 0;

    const recommended = this.#recommended();
    if (recommended.length) {
      this.root.append(this.#categorySection(RECOMMENDED_VALUE, RECOMMENDED_LABEL, recommended, []));
    }

    for (const category of this.#categories()) {
      const name = category.name?.trim();
      if (!name) {
        continue;
      }
      this.root.append(
        this.#categorySection(name, name, category.services ?? [], category.subcategories ?? []),
      );
    }

    if (!this.root.childElementCount) {
      this.root.append(this.#empty("No services available."));
    }
  }

  /**
   * @param {string} key
   * @param {string} label
   * @param {Service[]} services
   * @param {Subcategory[]} subcategories
   */
  #categorySection(key, label, services, subcategories) {
    const section = document.createElement("section");
    section.className = "ct-serv-cat";
    section.dataset.cat = key;
    section.setAttribute("aria-labelledby", this.#headingId("cat", key));

    const ownItems = this.#itemList(services, key, "");
    const subSections = subcategories
      .map((sub) => this.#subSection(key, sub))
      .filter((node) => node !== null);

    const count = (ownItems?.childElementCount ?? 0)
      + subSections.reduce((sum, node) => sum + Number(node.dataset.count ?? 0), 0);

    section.append(this.#stickyHead("cat", key, label, count));
    if (ownItems) {
      section.append(ownItems);
    }
    section.append(...subSections);
    this.totalCount += count;
    return section;
  }

  /**
   * @param {string} categoryKey
   * @param {Subcategory} sub
   */
  #subSection(categoryKey, sub) {
    const name = sub.name?.trim();
    const items = this.#itemList(sub.services ?? [], categoryKey, name ?? "");
    if (!name || !items) {
      return null;
    }

    const section = document.createElement("section");
    section.className = "ct-serv-sub";
    section.dataset.sub = name;
    section.dataset.count = String(items.childElementCount);
    section.setAttribute("aria-labelledby", this.#headingId("sub", categoryKey, name));
    section.append(this.#stickyHead("sub", categoryKey, name, items.childElementCount, name));
    section.append(items);
    return section;
  }

  /**
   * @param {"cat" | "sub"} kind
   * @param {string} categoryKey
   * @param {string} label
   * @param {number} count
   * @param {string} [subName]
   */
  #stickyHead(kind, categoryKey, label, count, subName = "") {
    const wrap = document.createElement("div");
    wrap.className = kind === "cat" ? "ct-serv-cat-sticky" : "ct-serv-sub-sticky";

    const face = document.createElement("div");
    face.className = kind === "cat" ? "ct-serv-cat-face" : "ct-serv-sub-face";

    const title = document.createElement(kind === "cat" ? "h2" : "h3");
    title.className = kind === "cat" ? "ct-serv-cat-title" : "ct-serv-sub-title";
    title.id = this.#headingId(kind, categoryKey, subName);
    title.textContent = label;

    const badge = document.createElement("p");
    badge.className = kind === "cat" ? "ct-serv-cat-count" : "ct-serv-sub-count";
    badge.textContent = String(count);

    face.append(title, badge);
    wrap.append(face);
    return wrap;
  }

  /**
   * @param {Service[]} services
   * @param {string} categoryKey
   * @param {string} subName
   */
  #itemList(services, categoryKey, subName) {
    if (!services.length) {
      return null;
    }

    const list = document.createElement("ul");
    list.className = "ct-serv-items";

    for (const service of services) {
      const name = service.name?.trim();
      if (!name) {
        continue;
      }
      const item = document.createElement("li");
      item.className = "ct-serv-item";
      item.dataset.name = name;
      item.dataset.cat = categoryKey;
      item.dataset.sub = subName;
      item.dataset.hay = this.#normalize(name);

      const title = document.createElement("p");
      title.className = "ct-serv-name";
      title.textContent = name;

      const price = document.createElement("p");
      price.className = "ct-serv-price";
      price.textContent = this.#formatPrice(service.price, service.currency);

      item.append(title, price);
      list.append(item);
    }

    return list.childElementCount ? list : null;
  }

  /**
   * @param {number | string | undefined} price
   * @param {string | undefined} currency
   */
  #formatPrice(price, currency = "RON") {
    if (typeof price === "number" && Number.isFinite(price)) {
      return `${new Intl.NumberFormat("ro-RO").format(price)} ${currency}`;
    }
    const text = String(price ?? "").trim();
    return text ? `${text} ${currency}` : currency;
  }

  #fillCategories() {
    const select = this.categorySelect;
    if (!select) {
      return;
    }

    select.replaceChildren();
    const recommended = this.#option(RECOMMENDED_VALUE, RECOMMENDED_LABEL);
    recommended.selected = true;
    select.append(recommended);

    for (const category of this.#categories()) {
      const name = category.name?.trim();
      if (name) {
        select.append(this.#option(name, name));
      }
    }
  }

  /**
   * @param {string} categoryKey
   */
  #fillSubcategories(categoryKey) {
    const select = this.subcategorySelect;
    if (!select) {
      return;
    }

    select.replaceChildren(this.#option("", ""));
    const category = this.#categories().find((item) => item.name === categoryKey);
    for (const sub of category?.subcategories ?? []) {
      const name = sub.name?.trim();
      if (name) {
        select.append(this.#option(name, name));
      }
    }
    select.value = "";
  }

  /**
   * @param {string} value
   * @param {string} label
   */
  #option(value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    return option;
  }

  #onCategoryChange() {
    if (this.syncing) {
      return;
    }
    const key = this.categorySelect?.value ?? RECOMMENDED_VALUE;
    this.#fillSubcategories(key);
    this.#scrollTo(`[data-cat="${CSS.escape(key)}"].ct-serv-cat`);
  }

  #onSubcategoryChange() {
    if (this.syncing) {
      return;
    }
    const cat = this.categorySelect?.value ?? "";
    const sub = this.subcategorySelect?.value ?? "";
    if (!sub) {
      this.#scrollTo(`[data-cat="${CSS.escape(cat)}"].ct-serv-cat`);
      return;
    }
    this.#scrollTo(`[data-cat="${CSS.escape(cat)}"] [data-sub="${CSS.escape(sub)}"].ct-serv-sub`);
  }

  /**
   * @param {number} step
   */
  #stepCategory(step) {
    const select = this.categorySelect;
    if (!select) {
      return;
    }
    const next = Math.min(select.options.length - 1, Math.max(0, select.selectedIndex + step));
    if (next === select.selectedIndex) {
      return;
    }
    select.selectedIndex = next;
    this.#onCategoryChange();
  }

  #onSearchInput() {
    const query = this.searchInput?.value ?? "";
    this.#applyQuery(query);
    this.#fillSuggestions(query);
  }

  /**
   * @param {KeyboardEvent} event
   */
  #onSearchKey(event) {
    const options = [...(this.searchPanel?.querySelectorAll("[role='option']") ?? [])];
    if (event.key === "Escape") {
      this.#hidePanel();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!options.length) {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      this.activeOption = (this.activeOption + delta + options.length) % options.length;
      this.#paintActive(options);
      return;
    }
    if (event.key === "Enter" && this.activeOption >= 0 && options[this.activeOption]) {
      event.preventDefault();
      this.#chooseSuggestion(options[this.activeOption]);
    }
  }

  /**
   * @param {MouseEvent} event
   */
  #onSuggestionClick(event) {
    const option = event.target instanceof Element ? event.target.closest("[role='option']") : null;
    if (option) {
      event.preventDefault();
      this.#chooseSuggestion(option);
    }
  }

  /**
   * @param {Element} option
   */
  #chooseSuggestion(option) {
    const name = option.getAttribute("data-name") ?? "";
    if (this.searchInput) {
      this.searchInput.value = name;
    }
    this.#applyQuery(name);
    this.#hidePanel();
    const item = this.root?.querySelector(`.ct-serv-item[data-name="${CSS.escape(name)}"]`);
    item?.scrollIntoView({ block: "center" });
  }

  /**
   * @param {string} query
   */
  #fillSuggestions(query) {
    if (!this.searchPanel || !this.searchInput) {
      return;
    }

    const needle = this.#normalize(query);
    this.searchPanel.replaceChildren();
    this.activeOption = -1;

    if (!needle) {
      this.#hidePanel();
      return;
    }

    const matches = [...(this.root?.querySelectorAll(".ct-serv-item") ?? [])]
      .filter((item) => (item.dataset.hay ?? "").includes(needle))
      .slice(0, MAX_SUGGESTIONS);

    if (!matches.length) {
      const empty = document.createElement("li");
      empty.className = "ct-search-empty";
      empty.textContent = "No matches";
      this.searchPanel.append(empty);
    } else {
      for (const item of matches) {
        const option = document.createElement("li");
        option.className = "ct-search-option";
        option.setAttribute("role", "option");
        option.dataset.name = item.dataset.name ?? "";

        const name = document.createElement("span");
        name.className = "ct-search-option-name";
        name.textContent = item.dataset.name ?? "";

        const price = document.createElement("span");
        price.className = "ct-search-option-price";
        price.textContent = item.querySelector(".ct-serv-price")?.textContent ?? "";

        option.append(name, price);
        this.searchPanel.append(option);
      }
    }

    this.searchPanel.hidden = false;
    this.searchInput.setAttribute("aria-expanded", "true");
  }

  /**
   * @param {Element[]} options
   */
  #paintActive(options) {
    options.forEach((option, index) => {
      option.setAttribute("aria-selected", index === this.activeOption ? "true" : "false");
    });
    options[this.activeOption]?.scrollIntoView({ block: "nearest" });
  }

  #hidePanel() {
    this.activeOption = -1;
    if (this.searchPanel) {
      this.searchPanel.hidden = true;
      this.searchPanel.replaceChildren();
    }
    this.searchInput?.setAttribute("aria-expanded", "false");
  }

  /**
   * @param {string} query
   */
  #applyQuery(query) {
    const needle = this.#normalize(query);
    let visible = 0;

    this.root?.querySelectorAll(".ct-serv-item").forEach((item) => {
      const on = !needle || (item.dataset.hay ?? "").includes(needle);
      item.hidden = !on;
      if (on) {
        visible += 1;
      }
    });

    this.root?.querySelectorAll(".ct-serv-sub").forEach((sub) => {
      const on = Boolean(sub.querySelector(".ct-serv-item:not([hidden])"));
      sub.hidden = !on;
    });

    this.root?.querySelectorAll(".ct-serv-cat").forEach((cat) => {
      const on = Boolean(cat.querySelector(".ct-serv-item:not([hidden])"));
      cat.hidden = !on;
    });

    const empty = this.root?.querySelector(".ct-serv-empty");
    if (visible === 0 && this.totalCount) {
      if (!empty) {
        this.root?.append(this.#empty("No services match that search."));
      }
    } else {
      empty?.remove();
    }

    this.#syncPosition(visible);
  }

  /**
   * @param {number} [visible]
   */
  #syncPosition(visible = this.totalCount) {
    if (!this.positionEl) {
      return;
    }
    if (!this.totalCount) {
      this.positionEl.textContent = "0 services";
      return;
    }
    this.positionEl.textContent = visible === this.totalCount
      ? `${this.totalCount} services`
      : `${visible} of ${this.totalCount}`;
  }

  /**
   * @param {string} selector
   */
  #scrollTo(selector) {
    const target = this.root?.querySelector(selector);
    if (!(target instanceof HTMLElement) || !this.main) {
      return;
    }
    const mainBox = this.main.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    this.main.scrollTo({
      top: this.main.scrollTop + (targetBox.top - mainBox.top) - 4,
      behavior: "smooth",
    });
  }

  /**
   * @param {string} text
   */
  #empty(text) {
    const note = document.createElement("p");
    note.className = "ct-serv-empty";
    note.textContent = text;
    return note;
  }

  /**
   * @param {"cat" | "sub"} kind
   * @param {string} categoryKey
   * @param {string} [subName]
   */
  #headingId(kind, categoryKey, subName = "") {
    return `ct-serv-${kind}-${this.#slug(categoryKey)}${subName ? `-${this.#slug(subName)}` : ""}`;
  }

  /**
   * @param {string} value
   */
  #slug(value) {
    return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "item";
  }

  /**
   * @param {string} value
   */
  #normalize(value) {
    return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  }
}
