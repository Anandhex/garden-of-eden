import type { NpcPersona } from "../npc/types.js";
import { materialisePeople } from "../store/materialise.js";
import type { CreatureTemplate } from "./creatures.js";
import type { WorldStore } from "./db.js";
import { importDeaths, loadWorldWithNotice, newWorld, type SavedWorld } from "./save.js";

export interface OpenedWorld {
  world: SavedWorld;
  /** One line for the player, when something happened to their save (an old one set aside). */
  notice: string | null;
}

/**
 * The world to play (N18): a new one, or the saved one, together with its database. A new world
 * (or one begun because the old save was from before v11) starts from an empty database and has
 * every settlement's people rolled into it. Throws `SaveMismatchError` when the save file and the
 * database are from different moments.
 */
export function openWorld(o: {
  file: string;
  deathsFile: string;
  personas: Record<string, NpcPersona>;
  templates: Record<string, CreatureTemplate>;
  store: WorldStore;
  fresh: boolean;
}): OpenedWorld {
  let world: SavedWorld;
  let notice: string | null = null;
  if (o.fresh) {
    o.store.reset();
    world = newWorld(o.personas, o.templates);
  } else {
    const loaded = loadWorldWithNotice(o.file, o.personas, o.templates, o.store);
    world = importDeaths(loaded.world, o.deathsFile);
    notice = loaded.notice;
  }
  // No people yet: a new world, an old save set aside, or a database that was deleted. (The last can only
  // roll the people the realm would give now; the pair stays consistent from here.)
  if (world.realm && o.store.people.count() === 0) materialisePeople(world.realm, o.store.people, world.day);
  return { world, notice };
}
