import type { KnownEntry } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import type { Realm } from "../realm/types.js";
import { stories, type Story } from "../stories/detect.js";

/**
 * The shareable chronicle (N23 step 5): the realm's history by day, as recorded text (the realm's news of note, the stories N20 found
 * with their chains), so two machines with the same world write the same file byte for byte. `view: "player"` keeps only what the
 * player knew (N24's `player.known`), dated by when they learned it. No personal data but the player's chosen name.
 */
export interface ChronicleEntry {
  day: number;
  kind: string;
  text: string;
  /** A story's chain, in words, oldest first. */
  chain?: string[];
}

export interface ChronicleOptions {
  view: "truth" | "player";
  known?: Record<string, KnownEntry>;
  /** News below this importance is left out. */
  minImportance?: number;
}

export function chronicleOf(realm: Realm, store: Pick<WorldStore, "sql" | "eventById">, o: ChronicleOptions): ChronicleEntry[] {
  const known = o.known ?? {};
  const min = o.minImportance ?? 6;
  const out: ChronicleEntry[] = [];
  for (const n of realm.news) {
    if (n.importance < min) continue;
    if (o.view === "player") {
      const k = known[`n:${n.id}`];
      if (!k) continue;
      out.push({ day: k.day, kind: n.kind, text: n.text });
    } else out.push({ day: n.day, kind: n.kind, text: n.text });
  }
  for (const s of stories(store, 200)) {
    const day = o.view === "player" ? learnedStory(s, known) : s.lastDay;
    if (day === null) continue;
    const chain = s.refs.map((id) => store.eventById(id)?.details ?? id);
    out.push({ day, kind: "story", text: s.title, chain });
  }
  return out.sort((a, b) => a.day - b.day || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.text < b.text ? -1 : 1));
}

/** When the player knew a story's end (they know its last event), or null. */
function learnedStory(s: Story, known: Record<string, KnownEntry>): number | null {
  return known[`e:${s.sink}`]?.day ?? null;
}

const esc = (x: string): string => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One static HTML page, no scripts: the chronicle by day. */
export function chronicleHtml(title: string, entries: ChronicleEntry[], view: ChronicleOptions["view"]): string {
  const days = new Map<number, ChronicleEntry[]>();
  for (const e of entries) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const body = [...days]
    .map(([day, es]) => `<section><h2>Day ${day}</h2><ul>${es.map((e) => `<li class="${esc(e.kind)}">${esc(e.text)}${e.chain ? `<ol>${e.chain.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` : ""}</li>`).join("")}</ul></section>`)
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 Georgia,serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#2b2118;background:#f7f1e3}h1{font-size:1.6rem}h2{font-size:1.1rem;border-bottom:1px solid #cdbf9f;margin-top:1.6rem}li.story{font-style:italic}ol{font-style:normal;color:#5a4a36;font-size:.92rem}</style>
</head><body><h1>${esc(title)}</h1><p>${view === "player" ? "As the traveller knew it." : "As it happened."}</p>
${body}
</body></html>
`;
}
