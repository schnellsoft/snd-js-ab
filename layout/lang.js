const FOLDERS = {
  ro: "romanian",
  bg: "bulgarian",
  en: "english",
};

/** @type {Set<(folder: string) => void>} */
const listeners = new Set();

/**
 * Folder name for the language currently chosen in the header.
 * @returns {string}
 */
export function languageFolder() {
  const select = document.querySelector("#ct-lang-select");
  const value = select instanceof HTMLSelectElement ? select.value : "ro";
  return FOLDERS[value] || "romanian";
}

/**
 * Run when the header language select changes.
 * @param {(folder: string) => void} fn
 */
export function onLanguageChange(fn) {
  listeners.add(fn);
}

function emit() {
  const select = document.querySelector("#ct-lang-select");
  if (select instanceof HTMLSelectElement) {
    document.documentElement.lang = select.value || "ro";
  }
  const folder = languageFolder();
  for (const fn of listeners) {
    fn(folder);
  }
}

const select = document.querySelector("#ct-lang-select");
if (select instanceof HTMLSelectElement) {
  document.documentElement.lang = select.value || "ro";
  select.addEventListener("change", () => {
    emit();
  });
}
