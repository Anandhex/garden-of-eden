import type { PlayerState } from "../../npc/types.js";
import { config } from "../../config.js";
import { adjustRel } from "../chatter/rel.js";
import { learn } from "../gossip/knowledge.js";
import { eventRef } from "../gossip/refs.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { realmNews } from "../realm/log.js";
import type { Realm } from "../realm/types.js";
import { seasonDays } from "../weather.js";
import { cultureAt, cultureById, tongueDistance, writeCultures, type Culture } from "./model.js";

/**
 * Cultures over time and the player among them (N53 decisions 5–7).
 *
 * - **Mixing:** a place on many roads (three or more) leans each season toward the cultures of the places it trades with; once another
 *   culture's share passes MIX_ADOPT it takes up one of that culture's customs (news).
 * - **Tongues:** the player speaks their start town's tongue and learns others by living among them (a little a day); a stranger's tongue
 *   known poorly makes persuasion harder by the tongues' distance.
 * - **Customs and taboos:** breaking a taboo where people see it offends them all (feelings toward the player and their name there);
 *   keeping a custom earns a little respect.
 */
export const MIX_STEP = 0.03;
export const MIX_ADOPT = 0.3;

export interface Mix {
  base: string;
  mix: Record<string, number>;
  adopted: string[];
}

export function cultureRealmDay(realm: Realm, day: number): void {
  if (!config.society.cultures) return;
  if (!realm.society?.cultures || Object.values(realm.kingdoms).some((k) => !k.culture)) writeCultures(realm);
  if (day % seasonDays() !== 0) return;
  const mixes = ((realm.society ??= {}).cultureMix ??= {}) as Record<string, Mix>;
  for (const s of Object.values(realm.settlements).sort((a, b) => a.id.localeCompare(b.id))) {
    if (s.way || s.abandoned || s.roads.length < 3) continue;
    const mine = cultureAt(realm, s.id);
    if (!mine) continue;
    const m = (mixes[s.id] ??= { base: mine.id, mix: {}, adopted: [] });
    for (const n of s.roads.map((id) => realm.settlements[id]).filter((x) => x && !x.way)) {
      const theirs = cultureAt(realm, n!.id);
      if (!theirs || theirs.id === mine.id) continue;
      const before = m.mix[theirs.id] ?? 0;
      m.mix[theirs.id] = Math.min(0.5, Math.round((before + MIX_STEP) * 100) / 100);
      if (before < MIX_ADOPT && m.mix[theirs.id]! >= MIX_ADOPT) {
        const custom = theirs.customs.find((c) => !mine.customs.includes(c) && !m.adopted.includes(c));
        if (custom) {
          m.adopted.push(custom);
          realmNews(realm, day, s.id, "culture", `${s.name} has taken up a custom of ${theirs.name}: ${custom.replace(/_/g, " ")}.`, 2, [s.name], { why: "trade and travellers over the years" });
        }
      }
    }
  }
}

/** The customs a place keeps: its culture's and those it took up. */
export function customsAt(realm: Realm, site: string): { customs: string[]; taboos: string[]; culture: Culture | null } {
  const c = cultureAt(realm, site);
  const m = (realm.society?.cultureMix as Record<string, Mix> | undefined)?.[site];
  return { culture: c, customs: [...(c?.customs ?? []), ...(m?.adopted ?? [])], taboos: c?.taboos ?? [] };
}

// ---- The player ----

export function tonguesOf(realm: Realm, p: PlayerState): Record<string, number> {
  p.society ??= {};
  const t = (p.society.tongues ??= {}) as Record<string, number>;
  if (Object.keys(t).length === 0 && p.site) {
    const home = cultureAt(realm, p.site);
    if (home) t[home.id] = 1;
  }
  return t;
}

/** A day lived among a culture's people: a little more of their tongue. */
export function dayAmong(realm: Realm, p: PlayerState, site: string): void {
  const c = cultureAt(realm, site);
  if (!c) return;
  const t = tonguesOf(realm, p);
  t[c.id] = Math.min(1, Math.round(((t[c.id] ?? 0) + 0.02) * 1000) / 1000);
}

/** How much harder talking someone round is in a place's tongue the player doesn't have: 0 (fluent) .. 0.8. */
export function tonguePenalty(realm: Realm, p: PlayerState, site: string): number {
  const c = cultureAt(realm, site);
  if (!c) return 0;
  const t = tonguesOf(realm, p);
  const best = Math.max(t[c.id] ?? 0, ...Object.entries(t).map(([id, v]) => {
    const other = cultureById(realm, id);
    return other ? v * (1 - tongueDistance(c, other)) : 0;
  }));
  return Math.max(0, Math.min(0.8, 1 - best));
}

/** The player breaks a local taboo in sight of people: they're all offended. Returns lines (nothing if it's no taboo here). */
export function breakTaboo(ctx: LifeCtx, p: PlayerState, site: string, taboo: string, witnesses: string[], day: number, hour: number): string[] {
  const { taboos, culture } = customsAt(ctx.realm, site);
  if (!taboos.includes(taboo)) return [];
  for (const w of witnesses) adjustRel(ctx.store, w, "player", { affection: -12, respect: -10, trust: -5 }, day);
  const rep = (p.reputation ??= { trust: 0, fear: 0, respect: 0, affection: 0 });
  rep.respect -= 5;
  rep.affection -= 3;
  const e = recordLifeEvent(ctx.realm, ctx.store, { kind: "taboo", actor: "player", site, day, hour, key: `player:${taboo}:${day}:${hour}`, details: `${p.name} broke a taboo: ${taboo.replace(/_/g, " ")}`, importance: 4, witnesses });
  for (const w of witnesses) learn(ctx, w, eventRef(e.id), { day, source: "saw", accuracy: 1 });
  (p.society ??= {}).learnedTaboos = [...new Set([...(p.society.learnedTaboos ?? []), `${culture?.id}:${taboo}`])];
  return [`Faces turn hard. Here, ${taboo.replace(/_/g, " ")} is not done.`];
}

/** The player keeps a local custom: a little respect from those who see it. */
export function keepCustom(ctx: LifeCtx, p: PlayerState, site: string, custom: string, witnesses: string[], day: number): string[] {
  if (!customsAt(ctx.realm, site).customs.includes(custom)) return [];
  for (const w of witnesses) adjustRel(ctx.store, w, "player", { respect: 5, affection: 3 }, day);
  return [`It's noticed, and liked: you know the ways here.`];
}
