import { type Creature, type CreatureTemplate, spawnCreature } from "../creatures.js";
import type { Rng } from "../dice.js";
import type { Life } from "../life.js";
import { formatMoney } from "../money.js";
import type { PlayerState } from "../../npc/types.js";
import { speciesOf } from "../../world/species.js";
import { killFigure, titled } from "./figures.js";
import { realmNews, tally } from "./log.js";
import { plural } from "./names.js";
import type { Figure, Realm } from "./types.js";

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
export function stockHaunts(realm: Realm, creatures: Record<string, Creature>, site: string, templates: Record<string, CreatureTemplate>, day: number, rng: Rng, talking: (f: Figure) => boolean = () => false): Creature[] {
  if (!realm.settlements[site]) return [];
  const here = creatures;
  const isHaunt = (c: Creature) => !!c.packId || c.den === GANG_DEN;
  for (const [uid, c] of Object.entries(here)) if (c.outcome && isHaunt(c)) delete here[uid];
  // The pack (or packs) that roam its woods.
  for (const p of Object.values(realm.packs).filter((x) => x.near === site)) {
    const t = templates[p.species];
    if (!t) continue;
    const mine = Object.values(here).filter((c) => c.packId === p.id);
    const want = Math.min(p.count, MAX_ON_MAP);
    for (const c of mine.slice(want)) delete here[c.uid];
    const alpha = p.alpha ? realm.figures[p.alpha] : undefined;
    for (let i = mine.length; i < want; i++) {
      const c = spawnCreature(t, `${site}-${p.species}-${realm.next++}`, day, rng, `${t.name} ${i + 1}`);
      c.packId = p.id;
      c.den = BEAST_DEN;
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
  }
  // The gang in its camp, by name.
  const gang = gangOf(realm, site);
  const members = gang
    ? [...gang.members]
        .map((id) => realm.figures[id])
        .filter((f): f is Figure => !!f && f.alive && speciesOf(f.species).talks && !talking(f))
        .sort((a, b) => (b.id === gang.leader ? 1 : 0) - (a.id === gang.leader ? 1 : 0) || b.renown - a.renown)
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

/**
 * After a fight on another place's map: the dead go back to the realm. A beast is one
 * fewer in its pack, with a share of the bounty on it for the player; a named one
 * (the alpha, a gang member) is a realm death, with news. Those who ran are gone
 * until the next visit. Returns lines for the player.
 */
export function settleHaunts(realm: Realm, creatures: Record<string, Creature>, site: string, player: PlayerState, day: number): string[] {
  const here = creatures;
  const lines: string[] = [];
  const s = realm.settlements[site];
  for (const [uid, c] of Object.entries(here)) {
    if (!c.outcome || (!c.packId && c.den !== GANG_DEN)) continue;
    delete here[uid];
    if (c.outcome !== "dead") continue;
    const p = c.packId ? realm.packs[c.packId] : undefined;
    if (p) {
      p.count = Math.max(0, p.count - 1);
      tally(realm, "culled");
      if (p.bounty > 0) {
        const paid = Math.ceil(p.bounty / Math.max(1, p.count + 1));
        p.bounty -= paid;
        player.money += paid;
        lines.push(`${s?.name ?? "The place"} pays you ${formatMoney(paid)} of the bounty on its ${plural(p.species)}.`);
      }
      if (p.count === 0) {
        realmNews(realm, day, site, "beasts", `The ${plural(p.species)} near ${s?.name ?? site} were hunted out by ${player.name}.`, 4, [player.name]);
        lines.push(`That was the last of the ${plural(p.species)} about ${s?.name ?? "here"}.`);
      }
    }
    const f = c.figure ? realm.figures[c.figure] : undefined;
    if (f && killFigure(realm, f, day, `killed by ${player.name}`)) {
      realmNews(realm, day, site, "death", `${titled(f)}${s ? ` of the wilds near ${s.name}` : ""} was killed by ${player.name}.`, f.renown >= 30 ? 6 : 4, [f.name, player.name]);
      player.renown = (player.renown ?? 0) + (f.renown >= 30 ? 5 : 2);
      lines.push(`Word will spread that ${f.name} is dead.`);
    }
  }
  return lines;
}
