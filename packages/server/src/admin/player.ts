import type { AdminBelief, AdminCard, AdminOpinion, AdminPlayerView } from "@millbrook/shared";
import { loanDue } from "../game/favours.js";
import { formatMoney } from "../game/money.js";
import { describeReputation } from "../game/reputation.js";
import { HOME_ID } from "../game/realm/generate.js";
import type { NpcState } from "../npc/types.js";
import type { AdminContext } from "./context.js";

/**
 * Pinning the player (N17): what each NPC currently believes about them, and who believes
 * what. The truth, not what the player knows of it. A person has a view of the player if
 * they've met, have heard a rumour, hold a grudge or a revenge goal, or feel anything about them.
 */

const hasView = (s: NpcState): boolean =>
  s.metBefore || s.grudge !== null || s.goals.length > 0 || s.relationship !== 0 || s.affection !== 0 || s.fear !== 0 || s.respect !== 0 || Object.values(s.rumours).some((r) => r.about === "player");

/** Everyone with a view of the player, strongest feelings first, and the rumours about the player grouped by who holds them. */
export function playerView(ctx: AdminContext): AdminPlayerView {
  const world = ctx.world();
  const town = ctx.town();
  const player = world.player;
  const opinions: AdminOpinion[] = [];
  const byKey = new Map<string, AdminBelief>();
  const people = new Set([...town.ids, ...town.visitorIds()]);
  for (const id of people) {
    const persona = town.personas[id];
    const state = town.agents[id]?.state ?? world.npcStates[id];
    if (!persona || !state || !hasView(state)) continue;
    const ref = id.startsWith("t_") ? `town:${id}` : `cast:${id}`;
    const rumours = Object.entries(state.rumours).filter(([, r]) => r.about === "player");
    for (const [key, r] of rumours) {
      const belief = byKey.get(key) ?? { key, text: r.text, truth: r.truth, firstHeard: r.day, holders: [] };
      belief.holders.push({ ref, name: persona.name, accuracy: r.accuracy, heardFrom: r.heardFrom ?? null, day: r.day });
      belief.firstHeard = Math.min(belief.firstHeard, r.day);
      byKey.set(key, belief);
    }
    const owes: string[] = [];
    if (state.owedFavours.length > 0) owes.push(`the player owes them ${state.owedFavours.length} favour${state.owedFavours.length > 1 ? "s" : ""}`);
    const loan = loanDue(player, id);
    if (loan) owes.push(`the player owes them a loan (${loan.amount !== undefined ? formatMoney(loan.amount) : "unpaid"})`);
    opinions.push({
      ref,
      name: persona.name,
      trust: state.relationship,
      fear: state.fear,
      respect: state.respect,
      affection: state.affection,
      grudge: state.grudge ? state.grudge.reason : null,
      goals: state.goals.map((g) => `${g.plan}: ${g.reason}`),
      owes,
      rumours: rumours.map(([key, r]) => ({ key, text: r.text, accuracy: r.accuracy })),
    });
  }
  opinions.sort((a, b) => Math.abs(b.affection) + Math.abs(b.trust) + b.fear - (Math.abs(a.affection) + Math.abs(a.trust) + a.fear) || a.name.localeCompare(b.name));
  const beliefs = [...byKey.values()].sort((a, b) => b.holders.length - a.holders.length || a.key.localeCompare(b.key));
  for (const b of beliefs) b.holders.sort((x, y) => y.accuracy - x.accuracy || x.name.localeCompare(y.name));
  return {
    name: player.name,
    money: player.money,
    bounty: player.bounty ?? 0,
    reputation: player.reputation ?? null,
    standing: { ...(player.standing ?? {}) },
    opinions,
    beliefs,
  };
}

/** The player's own card: where they are and the headline numbers. */
export function playerCard(ctx: AdminContext): AdminCard {
  const world = ctx.world();
  const p = world.player;
  const site = p.site ?? HOME_ID;
  const siteName = world.realm?.settlements[site]?.name ?? site;
  const view = playerView(ctx);
  const rep = describeReputation(p.reputation);
  return {
    ref: "player",
    kind: "player",
    name: p.name,
    subtitle: `level ${p.level}, in ${siteName}`,
    alive: !p.death,
    site,
    siteName,
    doing: p.death ? `dead, killed by ${p.death.killedBy}` : `at ${world.location}`,
    sections: [
      {
        title: "Right now",
        rows: [
          ["Where", `${siteName}, ${world.location}`, `place:${site}`],
          ["Health", `${Math.round(p.hp)} / ${p.maxHp}`],
          ["Purse", formatMoney(p.money)],
          ["Bounty", p.bounty ? formatMoney(p.bounty) : "none"],
          ["Open crimes", String((p.crimes ?? []).length)],
        ],
      },
      {
        title: "Standing",
        rows: [
          ["Town's view", rep ?? "no strong view"],
          ...Object.entries(p.standing ?? {}).map(([f, n]): [string, string] => [f, String(n)]),
        ],
      },
      {
        title: "Who believes what",
        rows: view.beliefs.map((b): [string, string] => [b.text, `${b.holders.length} ${b.holders.length === 1 ? "person" : "people"} (${b.truth}); first heard day ${b.firstHeard}`]),
      },
      {
        title: "What they think of the player",
        rows: view.opinions.slice(0, 15).map((o): [string, string, string] => [o.name, `trust ${Math.round(o.trust)}, fear ${Math.round(o.fear)}, respect ${Math.round(o.respect)}, affection ${Math.round(o.affection)}${o.grudge ? `; grudge: ${o.grudge}` : ""}`, o.ref]),
      },
    ],
  };
}
