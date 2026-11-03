/**
 * Which world view this browser draws (G7): 2.5D or flat. It is this browser's setting (`millbrook-view`);
 * `?view=iso|flat` on the address overrides it for a visit. No imports, so the tests can read it.
 */
export type ViewKind = "iso" | "flat";

const KEY = "millbrook-view";
export const DEFAULT_VIEW: ViewKind = "iso";

/** The view to draw: `?view=` first, then the saved setting, then the default (2.5D). */
export function viewPref(search = typeof location === "undefined" ? "" : location.search, saved: string | null = readSaved()): ViewKind {
  const q = new URLSearchParams(search).get("view");
  if (q === "iso" || q === "flat") return q;
  return saved === "iso" || saved === "flat" ? saved : DEFAULT_VIEW;
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveViewPref(v: ViewKind): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // A private window: the setting lasts this visit.
  }
}

/** How many tiles each view asks the server for: the 2.5D diamond covers more ground than the flat window. */
export const VIEW_BOX: Record<ViewKind, { w: number; h: number }> = { flat: { w: 26, h: 18 }, iso: { w: 40, h: 40 } };

