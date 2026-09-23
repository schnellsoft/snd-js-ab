import { languageFolder, onLanguageChange } from "./lang.js";

const button = document.querySelector(".btn-appointment");
const label = button?.querySelector(".btn-text");
const consultation = document.querySelector(".snd-ct-consultation");
const bottom = document.querySelector(".header-bottom");
const header = document.querySelector("header");

/**
 * True when the full button fits inside the consultation slot.
 * @returns {boolean}
 */
function consultationFits() {
  if (!(button instanceof HTMLElement) || !(consultation instanceof HTMLElement)) {
    return false;
  }
  if (getComputedStyle(consultation).display === "none" || consultation.clientWidth <= 0) {
    return false;
  }
  const probe = button.cloneNode(true);
  if (!(probe instanceof HTMLElement)) {
    return false;
  }
  probe.setAttribute("aria-hidden", "true");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  consultation.append(probe);
  const width = probe.getBoundingClientRect().width;
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  const slack = 1;
  return width <= consultation.clientWidth + slack && height <= consultation.clientHeight + slack;
}

/** Keep the button centered in consultation, or move it to the lower header row. */
function placeButton() {
  if (!(button instanceof HTMLElement) || !(consultation instanceof HTMLElement) || !(bottom instanceof HTMLElement)) {
    return;
  }
  if (consultationFits()) {
    if (button.parentElement !== consultation) {
      consultation.append(button);
    }
    bottom.hidden = true;
    return;
  }
  if (button.parentElement !== bottom) {
    bottom.append(button);
  }
  bottom.hidden = false;
}

/** Load the appointment label for the active language, then place the button. */
async function loadAppointmentText() {
  if (!(label instanceof HTMLElement) || !(button instanceof HTMLElement)) {
    return;
  }
  const url = new URL(`data/${languageFolder()}/appointment.json`, import.meta.url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (typeof data.text === "string") {
      label.textContent = data.text;
      button.setAttribute("aria-label", data.text);
    }
  } catch {
    return;
  }
  placeButton();
}

if (header instanceof HTMLElement) {
  const observer = new ResizeObserver(() => {
    placeButton();
  });
  observer.observe(header);
  if (consultation instanceof HTMLElement) {
    observer.observe(consultation);
  }
}

window.matchMedia("(orientation: portrait) and (max-width: 48em)").addEventListener("change", () => {
  placeButton();
});

onLanguageChange(() => {
  loadAppointmentText();
});

loadAppointmentText();
