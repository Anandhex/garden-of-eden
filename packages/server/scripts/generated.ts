import { loadCreatureTemplates } from "../src/game/creatures.js";
import { newWorld } from "../src/game/save.js";
import { Town } from "../src/game/town.js";
import { OllamaProvider } from "../src/llm/ollama.js";
import type { NpcPersona } from "../src/npc/types.js";

/**
 * The game has no hand-written people (N25a), so the benchmark and simulation scripts run on generated ones:
 * the notables of the start towns of seeds 1, 2, 3... until there are enough, each a different person.
 * Same seeds, same cast.
 */
export function generatedCast(count = 8, firstSeed = 1): Record<string, NpcPersona> {
  const creatureTemplates = loadCreatureTemplates();
  const cast: Record<string, NpcPersona> = {};
  const names = new Set<string>();
  for (let seed = firstSeed; seed < firstSeed + 12 && Object.keys(cast).length < count; seed++) {
    const world = newWorld({}, creatureTemplates, () => 0.5, seed);
    const town = new Town({ personas: {}, creatureTemplates, world, llm: new OllamaProvider() });
    // The people of every place, not only the start town's: a guard or a merchant is somewhere else.
    for (const id of Object.keys(world.realm!.settlements)) town.meetNotables(id);
    for (const p of Object.values(town.personas)) {
      if (Object.keys(cast).length >= count) break;
      if (names.has(p.name.split(" ")[0]!)) continue;
      names.add(p.name.split(" ")[0]!);
      cast[p.id] = p;
    }
  }
  return cast;
}

/** The first of the cast for whom `want` holds, e.g. a smith with a secret. */
export function personaWhere(cast: Record<string, NpcPersona>, want: (p: NpcPersona) => boolean): NpcPersona {
  const p = Object.values(cast).find(want);
  if (!p) throw new Error("the generated cast has no one for this scenario; raise CAST");
  return p;
}

/** The cast's ids, or the ones named on the command line (a persona id, or a template: "smith", "guard"). */
export function pickIds(cast: Record<string, NpcPersona>, wanted: string[]): string[] {
  if (wanted.length === 0) return Object.keys(cast);
  return wanted.flatMap((w) => {
    const hits = Object.values(cast).filter((p) => p.id === w || p.template === w).map((p) => p.id);
    if (hits.length === 0) throw new Error(`No one "${w}" in the cast. Available: ${Object.values(cast).map((p) => `${p.id} (${p.template})`).join(", ")}`);
    return hits;
  });
}
