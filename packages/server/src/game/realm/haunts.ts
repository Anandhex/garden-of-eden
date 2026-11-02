import { payOut } from "./ledger.js";
import { type Creature, type CreatureTemplate, creatureStats, spawnCreature } from "../creatures.js";
import { fame } from "../office/repute.js";
import { type BeastRow, type BeastStore, woundsOf } from "../../store/beastStore.js";
import { afterFight, ageOfRow, killBeast, lifeOfRow } from "./beasts.js";
import type { Rng } from "../dice.js";
import type { Life } from "../life.js";
import { formatMoney } from "../money.js";
import type { PlayerState } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { killFigure, titled } from "./figures.js";
import { realmNews, tally } from "./log.js";
import { plural } from "./names.js";
import type { Figure, Pack, Realm } from "./types.js";

/**
 * The beasts and outlaws of a place, on its maps (N15, N25a). The realm keeps packs and gangs as numbers and
 * names (N13). When the player walks into a place's woods or a gang's camp, what the realm says is there turns
 * up on the map: so many of the pack (its named alpha among them), the gang's members by name. What the player
 * does to them goes back to the realm: a beast killed is one fewer in the pack (and a share of any bounty on
 * it), a gang member killed is a realm death. They live in the place's own creatures (`SiteState.creatures`),
 * with whatever else the place's spawn rules put there, so the same wolves are there next time.
 */

/** Most of a pack, or of a gang, about on the map at once. */
export const MAX_ON_MAP = 5;
/** Where they roam on another place's locality maps (web/sites.ts). */
export const BEAST_DEN = "deep_woods";
export const GANG_DEN = "camp";

/** The gang seated at a place, if any. */
export const gangOf = (realm: Realm, site: string) => Object.values(realm.factions).find((f) => f.kind === "gang" && f.dissolved === undefined && f.seat === site);

/**
 * Bring a place's haunts in line with the realm: the pack's beasts and the gang's
 * members on the map, no more than there are (thinned off-screen, they're gone).
 * `talking`: figures who are talking NPCs there already, not creatures.
 */
export function stockHaunts(realm: Realm, creatures: Record<string, Creature>, site: string, templates: Record<string, CreatureTemplate>, day: number, rng: Rng, talking: (f: Figure) => boolean = () => false, beasts?: BeastStore): Creature[] {
  if (!realm.settlements[site]) return [];
  const here = creatures;
  const isHaunt = (c: Creature) => !!c.packId || c.den === GANG_DEN;
  for (const [uid, c] of Object.entries(here)) if (c.outcome && isHaunt(c)) delete here[uid];
  // The pack (or packs) that roam its woods: its own beasts, by row, where the rows are kept.
  for (const p of Object.values(realm.packs).filter((x) => x.near === site)) stockPack(realm, here, p, `${site}`, templates, day, rng, beasts, BEAST_DEN);
  // The gang in its camp, by name.
  const gang = gangOf(realm, site);
  const members = gang
    ? [...gang.members]
        .map((id) => realm.figures[id])
        .filter((f): f is Figure => !!f && f.alive && speciesOf(f.species).talks && !talking(f))
        .sort((a, b) => (b.id === gang.leader ? 1 : 0) - (a.id === gang.leader ? 1 : 0) || fame(b) - fame(a))
        .slice(0, MAX_ON_MAP)
    : [];
  const wanted = new Set(members.map((f) => f.id));
  for (const [uid, c] of Object.entries(here)) if (!c.packId && c.den === GANG_DEN && (!c.figure || !wanted.has(c.figure))) delete here[uid];
  const t = templates.bandit;
  for (const f of members) {
    if (!t || Object.values(here).some((c) => c.figure === f.id)) continue;
    const c = spawnCreature(t, `${site}-bandit-${realm.next++}`, day, rng, f.name);
    c.figure = f.id;
    c.den = GANG_DEN;
    c.life = structuredClone(f.life) as Life;
    here[c.uid] = c;
  }
  return Object.values(here).filter(isHaunt);
}

/** A pack's beast as a creature: its row's life, hurt and name. */
export function beastCreature(realm: Realm, t: CreatureTemplate, b: BeastRow, uid: string, day: number, rng: Rng): Creature {
  const f = b.figure ? realm.figures[b.figure] : undefined;
  const age = ageOfRow(b, day);
  const young = age < speciesOf(b.species).adultAge;
  const c = spawnCreature(t, uid, day, rng, f?.alive ? f.name : `${young ? "young " : b.sex === "f" ? "she-" : ""}${t.name}${woundsOf(b).scars.length ? " (scarred)" : ""}`);
  c.life = structuredClone(f?.alive ? f.life : lifeOfRow(b)) as Life;
  c.hp = Math.max(1, Math.round(c.hp * woundsOf(b).hp));
  c.beast = b.id;
  c.packId = b.pack;
  if (f?.alive) c.figure = f.id;
  return c;
}

/**
 * Put a pack's beasts on a map (the woods, a den, the road): up to `max`, never more than it has, the alpha among them,
 * each a row where the rows are kept (else nameless, by count, for a world with no database).
 */
export function stockPack(realm: Realm, here: Record<string, Creature>, p: Pack, prefix: string, templates: Record<string, CreatureTemplate>, day: number, rng: Rng, beasts: BeastStore | undefined, den: string, max = MAX_ON_MAP): Creature[] {
  const t = templates[p.species];
  if (!t) return [];
  const mine = Object.values(here).filter((c) => c.packId === p.id);
  if (beasts) {
    const living = beasts.living(p.id);
    const lead = living.find((b) => b.figure && b.figure === p.alpha);
    const wanted = [...(lead ? [lead] : []), ...living.filter((b) => b !== lead && woundsOf(b).hp >= 0.5).sort((a, b) => b.wins - a.wins || (a.id < b.id ? -1 : 1))].slice(0, max);
    const ids = new Set(wanted.map((b) => b.id));
    for (const c of mine) if (!c.beast || !ids.has(c.beast)) delete here[c.uid];
    for (const b of wanted) {
      if (Object.values(here).some((c) => c.beast === b.id)) continue;
      const c = beastCreature(realm, t, b, `${prefix}-${b.id}`, day, rng);
      c.den = den;
      here[c.uid] = c;
    }
    return Object.values(here).filter((c) => c.packId === p.id);
  }
  const want = Math.min(p.count, max);
  for (const c of mine.slice(want)) delete here[c.uid];
  const alpha = p.alpha ? realm.figures[p.alpha] : undefined;
  for (let i = mine.length; i < want; i++) {
    const c = spawnCreature(t, `${prefix}-${p.species}-${realm.next++}`, day, rng, `${t.name} ${i + 1}`);
    c.packId = p.id;
    c.den = den;
    here[c.uid] = c;
  }
  // The named alpha leads them: one of them is it.
  const pack = Object.values(here).filter((c) => c.packId === p.id);
  for (const c of pack) if (c.figure && c.figure !== alpha?.id) delete c.figure;
  if (alpha?.alive && pack.length > 0 && !pack.some((c) => c.figure === alpha.id)) {
    const lead = pack[0]!;
    lead.figure = alpha.id;
    lead.name = alpha.name;
    lead.life = structuredClone(alpha.life) as Life;
  }
  return pack;
}

/**
 * After a fight on another place's map: the dead go back to the realm. A beast is one
 * fewer in its pack, with a share of the bounty on it for the player; a named one
 * (the alpha, a gang member) is a realm death, with news. Those who ran are gone
 * until the next visit. Returns lines for the player.
 */
export function settleHaunts(realm: Realm, creatures: Record<string, Creature>, site: string, player: PlayerState, day: number, beasts?: BeastStore, templates?: Record<string, CreatureTemplate>): string[] {
  const here = creatures;
  const lines: string[] = [];
  const s = realm.settlements[site];
  for (const [uid, c] of Object.entries(here)) {
    if (!c.packId && c.den !== GANG_DEN) continue;
    // A beast still standing carries its hurt home (it's the same beast next time).
    if (!c.outcome) {
      if (c.beast && beasts) {
        const t = templates?.[c.template];
        const max = t ? creatureStats(t, c).maxHp : c.hp;
        if (c.hp < max) afterFight(realm, beasts, c.beast, { hpShare: c.hp / Math.max(1, max), won: false, survived: false }, day);
      }
      continue;
    }
    delete here[uid];
    if (c.outcome !== "dead") {
      // Driven off: it lived through a fight with a person, and limps for it.
      if (c.beast && beasts) {
        const t = templates?.[c.template];
        lines.push(...afterFight(realm, beasts, c.beast, { hpShare: t ? c.hp / Math.max(1, creatureStats(t, c).maxHp) : 0.5, won: false, survived: true, ...(c.hp < (t ? creatureStats(t, c).maxHp * 0.3 : 0) ? { scar: "a torn ear" } : {}) }, day));
      }
      continue;
    }
    const p = c.packId ? realm.packs[c.packId] : undefined;
    if (p) {
      if (c.beast && beasts) {
        killBeast(realm, beasts, c.beast, day, `killed by ${player.name}`, "player");
        p.count = beasts.livingCount(p.id);
      } else p.count = Math.max(0, p.count - 1);
      tally(realm, "culled");
      if (p.bounty > 0) {
        const paid = payOut(realm, "player", Math.ceil(p.bounty / Math.max(1, p.count + 1)), `pack ${p.id}`, player, day);
        p.bounty -= paid;
        lines.push(`${s?.name ?? "The place"} pays you ${formatMoney(paid)} of the bounty on its ${plural(p.species)}.`);
      }
      if (p.count === 0) {
        realmNews(realm, day, site, "beasts", `The ${plural(p.species)} near ${s?.name ?? site} were hunted out by ${player.name}.`, 4, [player.name]);
        lines.push(`That was the last of the ${plural(p.species)} about ${s?.name ?? "here"}.`);
      }
    }
    const f = c.figure ? realm.figures[c.figure] : undefined;
    if (f && !c.beast && killFigure(realm, f, day, `killed by ${player.name}`)) {
      realmNews(realm, day, site, "death", `${titled(f)}${s ? ` of the wilds near ${s.name}` : ""} was killed by ${player.name}.`, fame(f) >= 30 ? 6 : 4, [f.name, player.name]);
      player.renown = (player.renown ?? 0) + (fame(f) >= 30 ? 5 : 2);
      lines.push(`Word will spread that ${f.name} is dead.`);
    }
  }
  return lines;
}
