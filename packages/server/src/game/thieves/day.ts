import { config } from "../../config.js";
import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { addGrievance } from "../chatter/grievance.js";
import { streamFor } from "../dice.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { sentencePerson } from "../law/justice.js";
import { transfer } from "../realm/ledger.js";
import { policyAt } from "../realm/policy.js";
import { arrestsDay, crimeDay, smuggleArrivals, smuggleDay } from "./crime.js";
import { denDay, denOf, guildAt, type DenData } from "./guilds.js";

/** A place's underworld on a day (N47): its den kept up, thefts and fencing, smuggling out, arrests in a crackdown. */
export function thievesSiteDay(ctx: LifeCtx, site: string, day: number): void {
  if (!config.society.underworld) return;
  if (!denDay(ctx, site, day)) return;
  crimeDay(ctx, site, day);
  smuggleDay(ctx, site, day);
  arrestsDay(ctx, site, day);
}

/** Smuggling runs arriving, once a day for the realm (a run crosses places). */
export function thievesRealmDay(ctx: LifeCtx, day: number): void {
  if (!config.society.underworld) return;
  smuggleArrivals(ctx, day);
}

// ---- The black market (N47 decision 3) ----

export interface Offer {
  id: string;
  what: string;
  price: number;
  kind: "stolen" | "banned" | "papers" | "secret";
}

/** What a den sells, to those it trusts: stolen goods, what the crown bans, forged papers. Dearer in a crackdown. */
export function blackMarket(ctx: LifeCtx, site: string, day: number): Offer[] {
  const den = denOf(ctx.store, site);
  if (!den || den.ended !== null) return [];
  const crack = policyAt(ctx.realm, site, "crackdown", day) === "on" ? 1.5 : 1;
  const out: Offer[] = [];
  if (den.data.fenced + den.data.stash > 0) out.push({ id: "stolen", what: "a stolen ring, no questions asked", price: Math.round(25 * crack), kind: "stolen" });
  // What the crown bans sells at a premium: a forbidden school's book (N51), freedom papers where slavery is law (N59).
  if (policyAt(ctx.realm, site, "magic:necromancy", day) !== "licensed") out.push({ id: "grimoire", what: "a necromancer's notebook (banned)", price: Math.round(120 * crack), kind: "banned" });
  const k = ctx.realm.settlements[site]?.kingdom;
  if (k && ctx.realm.kingdoms[k]?.laws.slavery) out.push({ id: "papers", what: "forged freedom papers", price: Math.round(150 * crack), kind: "papers" });
  else out.push({ id: "papers", what: "a forged travel pass", price: Math.round(60 * crack), kind: "papers" });
  return out;
}

/** The player's standing with the guild decides whether they're shown the market (N7's faction standing). */
export const trusted = (p: PlayerState, guild: string): boolean => (p.standing?.[guild] ?? 0) >= 10 || (p.factions ?? []).includes(guild);

/** Buy from the black market: coin to the guild. */
export function buyBlack(ctx: LifeCtx, p: PlayerState, site: string, offerId: string, day: number): string[] {
  const guild = guildAt(ctx.realm, site);
  if (!guild || !trusted(p, guild.id)) return ["Nobody here knows what you're talking about."];
  const o = blackMarket(ctx, site, day).find((x) => x.id === offerId);
  if (!o) return ["That's not to be had."];
  if (p.money < o.price) return [`It's ${o.price} copper.`];
  transfer(ctx.realm, "player", `f:${guild.id}`, o.price, `black market: ${o.what}`, p, day);
  p.society ??= {};
  (p.society.bought ??= []).push({ what: o.what, kind: o.kind, day });
  return [`You buy ${o.what} for ${o.price} copper.`];
}

/** The player joins the guild: a member (standing), shown its den and market. */
export function joinGuild(ctx: LifeCtx, p: PlayerState, site: string, day: number): string[] {
  const guild = guildAt(ctx.realm, site);
  if (!guild) return ["There's no guild of thieves here, or none that will own to it."];
  p.factions = [...new Set([...(p.factions ?? []), guild.id])];
  p.standing = { ...(p.standing ?? {}), [guild.id]: Math.max(10, p.standing?.[guild.id] ?? 0) };
  const den = denOf(ctx.store, site);
  if (den) ctx.store.records.patch<DenData>(den.id, { data: { found: [...new Set([...(den.data.found ?? []), "player"])] } });
  p.society ??= {};
  p.society.guild = { id: guild.id, rank: "footpad", since: day };
  return [`You're shown the cellar under the tavern. "${guild.name}," they say. "Footpads start at the bottom."`];
}

/**
 * The player informs on the guild (N47 decision 7): the watch takes the members the player can name, each goes before the law, and every
 * member left holds it against the player.
 */
export function informOn(ctx: LifeCtx, p: PlayerState, site: string, day: number): string[] {
  const { realm, store } = ctx;
  const guild = guildAt(realm, site);
  const den = denOf(store, site);
  if (!guild || !den) return ["You know of no guild here to inform on."];
  const rows = (store.people.loadSite(site, "full") as PersonRow[]).filter((r) => r.death === null && r.faction === guild.id && !r.away);
  const named = rows.filter((r) => den.data.ranks[r.id] !== "master thief").slice(0, Math.max(1, Math.ceil(rows.length / 2)));
  for (const m of named) {
    recordLifeEvent(realm, store, { kind: "crackdown", actor: m.id, target: "player", site, day, key: `${m.id}:informed`, details: `${m.name} of ${guild.name} was taken by the watch on the player's word`, importance: 4, why: "informed on" });
    sentencePerson(realm, store, m, "petty_theft", site, day, streamFor(realm.seed, "inform", m.id, day));
    store.people.update(m.id, { faction: null });
  }
  for (const r of rows.filter((x) => !named.includes(x))) addGrievance(store, { who: r.id, against: "player", cause: `informed:${guild.id}`, weight: 0.8, day });
  p.standing = { ...(p.standing ?? {}), [guild.id]: -60 };
  p.factions = (p.factions ?? []).filter((f) => f !== guild.id);
  store.records.patch<DenData>(den.id, { data: { arrests: den.data.arrests + named.length } });
  return [`The watch takes ${named.length} of ${guild.name} on your word. The rest will remember who talked.`];
}
