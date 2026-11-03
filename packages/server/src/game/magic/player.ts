import type { PlayerState } from "../../npc/types.js";
import type { PersonRow } from "../../store/peopleStore.js";
import { streamFor, unitFor, type Rng } from "../dice.js";
import { recordLifeEvent } from "../people/events.js";
import type { LifeCtx } from "../people/step.js";
import { transfer } from "../realm/ledger.js";
import { openPlayerCase } from "../law/player.js";
import { cast, type Cast } from "./cast.js";
import { forbiddenHere, giftOf, rollGift, schoolById, spellById, spells } from "./model.js";

/**
 * The player's magic (N51 step 7): a gift rolled at the start (low odds; or never), learned from a teacher (a hedge witch, for coin),
 * cast with MP and reagents, and hidden where it's banned: casting a forbidden school in sight of people is a case of sorcery, and
 * carrying a grimoire of it across a border where it's banned is contraband the toll finds.
 */
export interface PlayerMagic {
  gift: number;
  schools: Record<string, number>;
  corruption?: number;
}

export function magicOfPlayer(seed: number, p: PlayerState): PlayerMagic {
  p.society ??= {};
  return (p.society.magic ??= { gift: rollGift(seed, "player"), schools: {} }) as PlayerMagic;
}

/** A teacher here: the place's hedge witch (or anyone gifted who has a school), and what they teach. */
export function teacherAt(ctx: LifeCtx, site: string): PersonRow | null {
  return (ctx.store.people.loadSite(site, "full") as PersonRow[]).find((r) => r.death === null && giftOf(r)?.role === "hedge") ?? null;
}

/** Learn a spell from a teacher: the gift to hold it, the teacher's rank in its school, and coin. */
export function learnSpell(ctx: LifeCtx, p: PlayerState, site: string, spellId: string, day: number): string[] {
  const m = magicOfPlayer(ctx.realm.seed, p);
  const sp = spellById(spellId);
  const t = teacherAt(ctx, site);
  if (!sp) return ["No such spell."];
  if (!t) return ["There's nobody here to teach you."];
  if (m.gift <= 0) return [`${t.name} looks at you a long while. "There's nothing in you to teach, I'm afraid."`];
  if ((giftOf(t)?.schools[sp.school] ?? 0) < sp.rank) return [`${t.name} doesn't know ${sp.name}.`];
  if (sp.rank > m.gift + 1) return [`${sp.name} is beyond your gift.`];
  const fee = 20 * sp.rank;
  if (p.money < fee) return [`${t.name} wants ${fee} copper for the teaching.`];
  transfer(ctx.realm, "player", `s:${site}`, fee, `taught ${sp.name} by ${t.name}`, p, day);
  m.schools[sp.school] = Math.max(m.schools[sp.school] ?? 0, sp.rank);
  return [`${t.name} teaches you ${sp.name}. It takes the better part of a day.`];
}

/** The player casts. Where the school is forbidden and people see it, a sorcery case opens against them. */
export function playerCast(ctx: LifeCtx, p: PlayerState, spellId: string, site: string, day: number, hour: number, onlookers: string[], target: Parameters<typeof cast>[3] = null, rng: Rng = streamFor(ctx.realm.seed, "player-cast", day, hour)): Cast & { caseId?: string } {
  const m = magicOfPlayer(ctx.realm.seed, p);
  const sp = spellById(spellId);
  const caster = { mp: p.mp ?? 0, hp: p.hp, maxHp: p.maxHp, inventory: p.inventory, illness: p.illness ?? null, injuries: p.injuries ?? [], schools: m.schools, corruption: m.corruption ?? 0 };
  const r = cast(ctx, caster, spellId, target ?? caster, site, rng);
  p.mp = caster.mp;
  p.hp = caster.hp;
  m.corruption = caster.corruption;
  if (target === null && r.healed) p.hp = caster.hp;
  if (!sp || !r.ok && !r.misfire) return r;
  if (forbiddenHere(ctx.realm, site, sp.school, day) && onlookers.length > 0) {
    recordLifeEvent(ctx.realm, ctx.store, { kind: "spell", actor: "player", site, day, hour, key: `player:${spellId}:${day}:${hour}`, details: `${p.name} was seen working ${schoolById(sp.school)?.words ?? "magic"}`, importance: 5, witnesses: onlookers });
    const caseId = openPlayerCase(ctx, p, "sorcery", site, day, onlookers);
    return { ...r, lines: [...r.lines, "People saw. Here, that's sorcery."], caseId };
  }
  return r;
}

/**
 * Crossing into another kingdom (N51 step 7, N47's checkpoints): a grimoire of a school banned there is contraband. The toll looks through
 * the player's pack (more carefully under a crackdown): found, it's taken and there's a case.
 */
export function borderCheck(ctx: LifeCtx, p: PlayerState, from: string, to: string, day: number): string[] {
  const a = ctx.realm.settlements[from]?.kingdom;
  const b = ctx.realm.settlements[to]?.kingdom;
  if (!a || !b || a === b) return [];
  const books = Object.keys(p.inventory ?? {}).filter((k) => k.startsWith("grimoire") && (p.inventory![k] ?? 0) > 0);
  const m = p.society?.magic as PlayerMagic | undefined;
  const lines: string[] = [];
  const banned = Object.keys(m?.schools ?? {}).filter((sc) => forbiddenHere(ctx.realm, to, sc, day));
  if (banned.length > 0) lines.push(`In ${ctx.realm.kingdoms[b]!.name}, ${banned.map((sc) => schoolById(sc)?.words ?? sc).join(" and ")} is forbidden. Best keep what you know to yourself here.`);
  for (const k of books) {
    if (unitFor(ctx.realm.seed, "toll-search", day, k) >= 0.6) continue;
    p.inventory![k] = 0;
    openPlayerCase(ctx, p, "sorcery", to, day, []);
    lines.push(`The toll men go through your pack and find the ${k}. They take it, and take your name.`);
  }
  return lines;
}

export { spells };
