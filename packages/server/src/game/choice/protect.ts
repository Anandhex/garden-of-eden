import type { PlayerState, NpcPersona, NpcState } from "../../npc/types.js";
import type { PeopleStore } from "../../store/peopleStore.js";

/**
 * People nobody may do violence to by choice (N38): the player's companions, whoever the player is talking to, anyone who gave the player a
 * quest that is still open (a story the player is in must not end by accident), and children. They can still be insulted.
 */
export function protectedSet(
  player: Pick<PlayerState, "quests">,
  members: ReadonlyArray<{ id: string; persona: Pick<NpcPersona, "minor">; state: Pick<NpcState, "companion"> }>,
  talkingTo?: string,
  people?: Pick<PeopleStore, "get"> | null,
): Set<string> {
  const out = new Set<string>();
  if (talkingTo) out.add(talkingTo);
  for (const q of player.quests?.active ?? []) out.add(q.giverId);
  for (const m of members) {
    if (m.state.companion || m.persona.minor) out.add(m.id);
    if (people?.get(m.id)?.job === "child") out.add(m.id);
  }
  return out;
}

/** A child is protected too when they are only a row (the daily menu). */
export const isChildJob = (job: string): boolean => job === "child";
