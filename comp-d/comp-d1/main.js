import { Card } from "./card.js";

document.querySelectorAll(".ct-card").forEach((root) => {
  new Card(root).connect();
});
