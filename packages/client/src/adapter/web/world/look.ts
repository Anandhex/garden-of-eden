/**
 * The look's settings (G6), kept in this browser: atmosphere (fireflies, dust, fog, light shafts, the near
 * foreground) and its blur. `?atmosphere=0` on the address turns atmosphere off for that visit.
 */
export interface LookPrefs {
  atmosphere: boolean;
  blur: boolean;
}

const KEY = "millbrook-look";
const DEFAULTS: LookPrefs = { atmosphere: true, blur: true };

export function lookPrefs(search = typeof location === "undefined" ? "" : location.search): LookPrefs {
  let saved: Partial<LookPrefs> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<LookPrefs>;
  } catch {
    saved = {};
  }
  const p = { ...DEFAULTS, ...saved };
  const q = new URLSearchParams(search).get("atmosphere");
  if (q === "0" || q === "off") p.atmosphere = false;
  return p;
}

export function saveLook(p: LookPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // A private window: the setting lasts this visit.
  }
}
