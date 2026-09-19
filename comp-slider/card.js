const EMPTY_ITEM = { title: "", price: "", icon: "icon-generic" };

export class Card {
  /**
   * Paint one already-styled card face.
   * @param {HTMLElement} root
   */
  constructor(root) {
    this.root = root;
    this.face = root.querySelector(".ct-card-front-face") ?? root;
  }

  /**
   * @param {{ title: string, price: string, icon?: string } | null | undefined} item
   */
  paint(item) {
    const next = item ?? EMPTY_ITEM;
    const titleEl = this.face.querySelector(".ct-card-title");
    const priceEl = this.face.querySelector(".ct-card-price");
    const iconEl = this.face.querySelector(".ct-card-bg");
    const iconUse = iconEl?.querySelector("use") ?? null;

    if (titleEl) {
      titleEl.textContent = next.title;
    }
    if (priceEl) {
      priceEl.textContent = next.price;
    }
    this.#setIcon(iconEl, iconUse, next.icon);
  }

  /**
   * Point the watermark at a sprite symbol, or hide it when the id is missing.
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
}
