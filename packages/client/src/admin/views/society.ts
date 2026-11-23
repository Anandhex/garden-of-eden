import type { AdminClock } from "@garden-of-eden/shared";
import { el, emptyP } from "../../dom";
import { api } from "../api";
import { renderCard } from "../card";
import type { View } from "./types";

/**
 * Society (N70): the realm's Stages 4–5 state, as the server's `society` card: open feuds, cases and plots, omens and readings, armies
 * with their levies, and each war's roll of the fallen by battle. Drawn like any card; everything in it comes from the server.
 */
export class SocietyView implements View {
  readonly el = el("section", { className: "view society" });
  private busy = false;
  private lastDay = -1;

  async refresh(clock: AdminClock): Promise<void> {
    if (this.busy || (clock.day === this.lastDay && this.el.childElementCount > 0)) return;
    this.busy = true;
    try {
      const card = await api.card("society");
      this.lastDay = clock.day;
      this.el.replaceChildren(card ? renderCard(card, { nowHour: clock.hour }) : emptyP("No realm in this world."));
    } finally {
      this.busy = false;
    }
  }
}
