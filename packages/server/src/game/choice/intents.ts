import type { CrowdIntent } from "@millbrook/shared";
import type { WorldStore } from "../db.js";

/**
 * What the crowd shows townsfolk doing with a day they chose something for (N38). Worked out from the deeds that were recorded (each is
 * an event with a `choice:` key), so a world loaded elsewhere, or a place caught up years later, shows the same morning.
 */
const KIND: Record<string, string> = {
  confrontation: "confront",
  affront: "insult",
  menace: "insult",
  attacked: "attack",
  theft: "steal",
  "theft-caught": "steal",
  courtship: "court",
  recruited: "recruit",
  rumour: "gossip",
  "changed-mind": "travel",
  slight: "gossip",
};

export function intentsOn(store: Pick<WorldStore, "choiceDeeds">, site: string, day: number): CrowdIntent[] {
  const seen = new Set<string>();
  const out: CrowdIntent[] = [];
  for (const d of store.choiceDeeds(site, day)) {
    const kind = KIND[d.kind];
    if (!kind || seen.has(d.actor)) continue;
    seen.add(d.actor);
    const withTarget = kind !== "gossip" && kind !== "travel" && d.target;
    out.push({ id: d.actor, kind, ...(withTarget ? { target: d.target } : {}) });
  }
  return out;
}
