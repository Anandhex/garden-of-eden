import type { AdminBelief, AdminCard, AdminOpinion, AdminPlayerView } from "@millbrook/shared";
import { loanDue } from "../game/favours.js";
import { formatMoney } from "../game/money.js";
import { describeReputation } from "../game/reputation.js";
import type { NpcState } from "../npc/types.js";
import type { AdminContext } from "./context.js";
import { eventRef } from "../game/gossip/refs.js";
import { gradeRecord } from "../game/market/grades.js";
import { historyOf, itemName } from "../game/items/notable.js";
import { nemesesOf } from "../game/nemesis/model.js";

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
  const people = new Set(town.ids);
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
    sections: playerSections(ctx),
  };
}

/** What Stage 3 adds about the player (N39's first hour; later phases add theirs here). */
function playerSections(ctx: AdminContext): NonNullable<AdminPlayerView["sections"]> {
  const world = ctx.world();
  const out: NonNullable<AdminPlayerView["sections"]> = [];
  const fh = world.firstHour;
  if (fh) {
    const store = ctx.town().store;
    const heard = fh.event && store ? store.knowledge.holders(eventRef(fh.event)).length : 0;
    out.push({
      title: "The first hour",
      rows: [
        ["incident", `${fh.incident} at the ${fh.stage} (${fh.state})`],
        ["people in it", Object.entries(fh.names).map(([role, name]) => `${name} (${role})`).join(", ")],
        ...fh.staged.map((l): [string, string] => ["staged", l]),
        ...(fh.deed ? [["the player", fh.deed] as [string, string], ["who know of it", `${heard}`] as [string, string]] : []),
        ...(fh.owed?.length ? [["owe the player", fh.owed.map((id) => fh.names[Object.entries(fh.roles).find(([, x]) => x === id)?.[0] ?? ""] ?? id).join(", ")] as [string, string]] : []),
      ],
    });
  }
  // The notable items the player carries (N43): the full history of each, every hand it passed through.
  const store = ctx.town().store;
  if (world.realm && store) {
    for (const it of store.notables.heldBy("player")) out.push({ title: `${itemName(it)} (item:${it.id})`, rows: historyOf(it).map((e): [string, string] => [`day ${e.day} ${e.kind}`, `${e.name ?? e.who}${e.what ? ` (${e.what})` : ""}`]) });
  }
  // The player's nemeses (N44): the record, what they know of the player, what they've done and mean to do.
  if (world.realm) {
    for (const n of (world.realm.nemeses as ReturnType<typeof nemesesOf> | undefined)?.list ?? [])
      out.push({
        title: `Nemesis: ${n.name} (${n.stage})`,
        rows: [
          ["since", `day ${n.since}${n.rank ? `; ${n.rank}` : ""}`],
          ["meetings", ((world.realm.nemeses as ReturnType<typeof nemesesOf>).meetings?.[n.who] ?? []).map((m) => `day ${m.day} ${m.kind} (${m.outcome}, you used ${m.playerUsed.weapon ?? "?"})`).join("; ")],
          ["knows", `weapons ${JSON.stringify(n.knows.weapons)}, companions ${n.knows.companions}, sneaks ${n.knows.sneaks}`],
          ["prepared", n.prepared.join(", ") || "nothing yet"],
          ["men", n.men.map((id) => world.realm!.figures[id]?.name ?? id).join(", ") || "none"],
          ["struck", n.struck.map((s) => `day ${s.day}: ${s.what}`).join("; ") || "not yet"],
          ["plan", `${n.step}${n.taunt ? `; will say: "${n.taunt}"` : ""}`],
        ],
      });
  }
  // The player's grade on the market (N42), by the same rule as any adventurer's.
  const realm = world.realm;
  if (realm) {
    const g = gradeRecord(realm, "player", { player: world.player, peek: true });
    out.push({ title: "Adventurer grade", rows: [["grade", `${g.g}${g.trial ? ` (trial for ${g.trial} set)` : ""}`], ["jobs", `${g.total.done} done, ${g.total.failed} failed`], ["holds", (ctx.town().store?.jobs.list((j) => j.holder === "player" && j.status === "held") ?? []).map((j) => j.title).join(", ") || "nothing"]] });
  }
  return out;
}

/** The player's own card: where they are and the headline numbers. */
export function playerCard(ctx: AdminContext): AdminCard {
  const world = ctx.world();
  const p = world.player;
  const site = p.site ?? null;
  const siteName = (site ? world.realm?.settlements[site]?.name : undefined) ?? site ?? "nowhere";
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
