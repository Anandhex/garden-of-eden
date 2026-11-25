import type { WorldStore } from "../db.js";
import type { GameEvent } from "../events.js";
import type { Realm } from "../realm/types.js";
import { longestBack } from "./graph.js";

/**
 * The story detector (N20 step 3). Once a game day, in code, no model: the day's weighty events (importance STORY.seedAt or more, or a
 * death) that have a cause are walked back up to STORY.depth steps; each longest path of STORY.minLength or more is a story. A path that
 * runs through an existing story's last event grows that story (same id, new sink) instead of making a new one. The best STORY.keep are
 * kept; a story whose sink hasn't grown in STORY.closeAfter days is closed.
 *
 * Wording is a template here ("The quarrel of Aurelia and Titus: an insult, a grudge, an ambush."); N19's budget may word the best later.
 */
export const STORY = {
  seedAt: 5,
  depth: 8,
  minLength: 3,
  keep: 200,
  closeAfter: 96,
  /** Score weights: a step, a death, a place, the player in it, renown (per point). */
  perStep: 2,
  perDeath: 3,
  perPlace: 2,
  player: 3,
  perRenown: 1 / 20,
} as const;

export interface Story {
  id: string;
  /** The chain, oldest first: event ids. */
  refs: string[];
  sink: string;
  score: number;
  people: string[];
  places: string[];
  deaths: number;
  title: string;
  summary: string;
  worded: "model" | "template";
  firstDay: number;
  lastDay: number;
  open: boolean;
}

type Store = Pick<WorldStore, "causesOf" | "effectsOf" | "eventById" | "eventsOfDay" | "sql">;

const DEATHS = new Set(["death", "war-dead", "killed", "murder", "executed"]);

/** Words for an event in a chain: its kind, plainly ("attacked" → "an attack"). */
const WORD: Record<string, string> = { insult: "an insult", slight: "a slight", affront: "an affront", menace: "a threat", "new-goal": "a grudge", attacked: "an ambush", "npc-fight": "a fight", rumour: "a lie", revenge: "a plot", death: "a death", "war-dead": "a death in war", trial: "a trial", blackmail: "blackmail", theft: "a theft" };
const wordOf = (kind: string): string => WORD[kind] ?? `a ${kind.replace(/-/g, " ")}`;

/** Score a chain of events. */
export function scoreChain(realm: Pick<Realm, "figures">, events: GameEvent[]): { score: number; people: string[]; places: string[]; deaths: number } {
  const people = [...new Set(events.flatMap((e) => [e.actor, e.target]).filter((x) => !!x))].sort();
  const places = [...new Set(events.map((e) => e.site).filter((x): x is string => !!x))].sort();
  const deaths = events.filter((e) => DEATHS.has(e.kind)).length;
  const renown = people.reduce((t, p) => t + (realm.figures[p]?.renown ?? 0), 0);
  const player = people.includes("player") ? STORY.player : 0;
  const score = events.length * STORY.perStep + deaths * STORY.perDeath + places.length * STORY.perPlace + player + renown * STORY.perRenown;
  return { score: Math.round(score * 100) / 100, people, places, deaths };
}

/** A story's words from its chain, without a model. `nameOf` names a person id (a row's or a figure's name). */
export function wordStory(events: GameEvent[], nameOf: (id: string) => string | undefined): { title: string; summary: string } {
  const first = events[0]!;
  const last = events.at(-1)!;
  const a = nameOf(first.target || first.actor) ?? "someone";
  const b = nameOf(first.actor) ?? "someone";
  const who = a === b ? `of ${a}` : `between ${b} and ${a}`;
  const steps = events.map((e) => wordOf(e.kind));
  const title = `The quarrel ${who}: ${steps.slice(0, 4).join(", ")}${steps.length > 4 ? "…" : ""}.`;
  const summary = `It began when ${first.details.replace(/\.$/, "")}. It has come to this: ${last.details.replace(/\.$/, "")}.`;
  return { title: title.charAt(0).toUpperCase() + title.slice(1), summary };
}

function rowToStory(r: Record<string, unknown>): Story {
  const s = JSON.parse(String(r.data)) as Story;
  return r.open === undefined ? s : { ...s, open: Number(r.open) === 1 };
}

/** Every story, best first (open ones before closed among equals). */
export function stories(store: Pick<WorldStore, "sql">, limit = 50): Story[] {
  return (store.sql("SELECT data, open FROM stories ORDER BY score DESC, open DESC, id LIMIT ?").all(limit) as Array<Record<string, unknown>>).map(rowToStory);
}

export function storyById(store: Pick<WorldStore, "sql">, id: string): Story | null {
  const r = store.sql("SELECT data, open FROM stories WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? rowToStory(r) : null;
}

/** The stories an event is in (by its id in the chain). */
export function storiesWith(store: Pick<WorldStore, "sql">, ref: string): Story[] {
  return (store.sql("SELECT data, open FROM stories WHERE data LIKE ? ORDER BY score DESC, id").all(`%"${ref.replace(/[%_"]/g, "")}"%`) as Array<Record<string, unknown>>).map(rowToStory).filter((s) => s.refs.includes(ref));
}

function save(store: Pick<WorldStore, "sql">, s: Story): void {
  store.sql("INSERT INTO stories (id, sink, score, data, first_day, last_day, open) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET sink = excluded.sink, score = excluded.score, data = excluded.data, last_day = excluded.last_day, open = excluded.open").run(s.id, s.sink, s.score, JSON.stringify(s), s.firstDay, s.lastDay, s.open ? 1 : 0);
}

export interface StoriesDay {
  found: number;
  grown: number;
  closed: number;
}

/** One day of the detector. `nameOf` names people for the template words. */
export function storiesDay(realm: Realm, store: Store, day: number, nameOf: (id: string) => string | undefined): StoriesDay {
  const out: StoriesDay = { found: 0, grown: 0, closed: 0 };
  const seeds = store.eventsOfDay(day).filter((e) => (e.importance >= STORY.seedAt || DEATHS.has(e.kind)) && (e.causedBy?.length ?? 0) > 0);
  let seq = 0;
  const touched = new Set<string>();
  for (const seed of seeds) {
    const path = longestBack(store, seed.id, STORY.depth);
    const events = path.map((id) => store.eventById(id)).filter((e): e is GameEvent => !!e);
    if (events.length < STORY.minLength) continue;
    // A path that already is a story, or runs through one's last event, grows it.
    const ids = events.map((e) => e.id);
    let story: Story | null = null;
    for (const id of ids.slice(0, -1).reverse()) {
      const r = store.sql("SELECT data, open FROM stories WHERE sink = ? ORDER BY score DESC, id LIMIT 1").get(id) as Record<string, unknown> | undefined;
      if (r) {
        story = rowToStory(r);
        break;
      }
    }
    if (!story && (store.sql("SELECT 1 FROM stories WHERE sink = ?").get(seed.id) as unknown)) continue;
    const scored = scoreChain(realm, events);
    const words = wordStory(events, nameOf);
    if (story) {
      if (touched.has(story.id)) continue;
      story = { ...story, refs: ids, sink: seed.id, ...scored, ...words, worded: "template", lastDay: day, open: true };
      out.grown++;
    } else {
      story = { id: `st${day}-${++seq}`, refs: ids, sink: seed.id, ...scored, ...words, worded: "template", firstDay: events[0]!.day, lastDay: day, open: true };
      out.found++;
    }
    touched.add(story.id);
    save(store, story);
  }
  // Old ones close; past the cap the worst go.
  out.closed = Number(store.sql("UPDATE stories SET open = 0 WHERE open = 1 AND last_day < ?").run(day - STORY.closeAfter).changes);
  store.sql("DELETE FROM stories WHERE id NOT IN (SELECT id FROM stories ORDER BY score DESC, id LIMIT ?)").run(STORY.keep);
  return out;
}
