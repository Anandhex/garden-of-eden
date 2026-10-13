/**
 * NPC display names by id, for code that only has an id ("take word to Corporal
 * Reed", "Old Odo is here: a friend"). The game registers every persona at startup;
 * an unknown id is shown as is.
 */
const names: Record<string, string> = {};

export function registerNpcNames(n: Record<string, string>): void {
  Object.assign(names, n);
}

export function npcName(id: string): string {
  return names[id] ?? id;
}

export function npcNames(): Readonly<Record<string, string>> {
  return names;
}

/** Genders by id (from each voice), for "your wife" or "your son". Unknown: "spouse", "child". */
const genders: Record<string, string> = {};

export function registerNpcGenders(g: Record<string, string | undefined>): void {
  for (const [id, gender] of Object.entries(g)) if (gender) genders[id] = gender;
}

export function npcGender(id: string): string | undefined {
  return genders[id];
}
