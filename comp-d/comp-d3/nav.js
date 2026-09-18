import { Card } from "./card.js";

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
    /** @type {Card | null} */
    this.card = null;
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

    this.OBServices = await this.#loadServices();
    this.#fillCategories();
    this.#fillSubcategories([]);
    this.#setNavServices(this.#recommended());

    const root = document.querySelector(".ct-card");
    if (root instanceof HTMLElement) {
      this.card = new Card(root, { items: this.#toCardItems(this.nav_serv_vec) });
      this.card.connect();
    }

    this.controller = new AbortController();
    const { signal } = this.controller;

    this.categorySelect?.addEventListener("change", () => this.#onCategoryChange(), { signal });
    this.subcategorySelect?.addEventListener("change", () => this.#onSubcategoryChange(), { signal });
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
    this.card?.disconnect();
    this.card = null;
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
   */
  #fillSubcategories(subcategories) {
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

    for (const subcategory of subcategories) {
      const option = document.createElement("option");
      option.value = subcategory.name;
      option.textContent = subcategory.name;
      select.append(option);
    }

    select.selectedIndex = 0;
  }

  #onCategoryChange() {
    const value = this.categorySelect?.value ?? RECOMMENDED_VALUE;

    if (value === RECOMMENDED_VALUE) {
      this.#fillSubcategories([]);
      this.#setNavServices(this.#recommended());
      return;
    }

    const category = this.#findCategory(value);
    const subcategories = category?.subcategories ?? [];
    this.#fillSubcategories(subcategories);

    if (subcategories.length) {
      this.#setNavServices(subcategories[0].services ?? []);
      return;
    }

    this.#setNavServices(category?.services ?? []);
  }

  #onSubcategoryChange() {
    const categoryValue = this.categorySelect?.value ?? "";
    if (categoryValue === RECOMMENDED_VALUE) {
      return;
    }

    const category = this.#findCategory(categoryValue);
    const subcategoryName = this.subcategorySelect?.value ?? "";

    if (!subcategoryName) {
      this.#setNavServices(category?.services ?? []);
      return;
    }

    const subcategory = (category?.subcategories ?? []).find((item) => item.name === subcategoryName);
    this.#setNavServices(subcategory?.services ?? []);
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
    const rest = this.searchHits.filter((_, itemIndex) => itemIndex !== index);
    this.#setNavServices([chosen, ...rest]);
    this.#closePanel();
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

  /**
   * @param {Array<Service>} services
   */
  #setNavServices(services) {
    this.nav_serv_vec = services.slice();
    this.card?.setItems(this.#toCardItems(this.nav_serv_vec));
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
 */
