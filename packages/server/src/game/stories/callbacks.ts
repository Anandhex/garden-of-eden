import type { PlayerState } from "../../npc/types.js";
import type { WorldStore } from "../db.js";
import type { GameEvent } from "../events.js";
import { note } from "../journal.js";
import { recordLifeEvent } from "../people/events.js";
import type { Realm } from "../realm/types.js";
import { asEventId } from "./graph.js";

/**
 * Callbacks to the player's choices (N21). When a notable event traces back, within CALLBACK.depth cause links, to something the player
 * chose to do (spared a foe, stole, gave, broke a promise), it is a callback: kept in the `callbacks` table until the player could know
 * both ends. The player always knows their own choice; the outcome they must have learned (seen it, been told, the news reached them:
 * N24's `player.known`). Then the journal ties the two together, from a template, never revealing more than they know.
 *
 * At most CALLBACK.perDay told a day; the same choice not again within CALLBACK.choiceGap days unless the outcome is a death; pending ones
 * older than CALLBACK.keepDays are dropped.
 *
 * Telling through a townsperson's mouth (a context line for whoever knows both ends, checked in their reply) is the next step: the gate
 * for it, `canTell`, is here.
 */
export const CALLBACK = {
  depth: 4,
  importance: 7,
  renown: 25,
  perDay: 1,
  choiceGap: 3,
  keepDays: 96,
} as const;

/** What counts as the player's choice (N38+ add theirs). */
export const PLAYER_CHOICES = new Set<string>(["killed", "spared", "subdued", "theft", "gift", "promise-kept", "promise-broken", "favour", "rumour", "quest-done", "quest-failed", "attacked", "lied-to", "amends"]);

export const isPlayerChoice = (e: Pick<GameEvent, "actor" | "kind">): boolean => e.actor === "player" && PLAYER_CHOICES.has(e.kind);

const DEATHS = new Set(["death", "war-dead", "killed", "murder", "executed"]);

export interface Callback {
  id: string;
  choice: string;
  outcome: string;
  /** Event ids from the choice to the outcome. */
  path: string[];
  score: number;
  found: number;
  told?: { day: number; by: "npc" | "journal"; npc?: string };
}

type Store = Pick<WorldStore, "causesOf" | "eventById" | "eventsOfDay" | "sql" | "archiveEvent">;

/** Is this outcome worth telling: weighty, the death of someone of note, or the end of a story that grew today. */
export function isNotable(realm: Pick<Realm, "figures">, e: GameEvent, storySinks: ReadonlySet<string> = new Set()): boolean {
  if (e.actor === "player") return false;
  if (e.importance >= CALLBACK.importance) return true;
  if (DEATHS.has(e.kind) && (realm.figures[e.actor]?.renown ?? 0) >= CALLBACK.renown) return true;
  return storySinks.has(e.id);
}

/** The player's choices behind an event, within `depth` links, each with its path (choice first, outcome last). */
export function choicesBehind(store: Pick<WorldStore, "causesOf" | "eventById">, outcome: string, depth: number = CALLBACK.depth): Array<{ choice: GameEvent; path: string[] }> {
  const parent = new Map<string, string>();
  const seen = new Set([outcome]);
  let level = [outcome];
  const out: Array<{ choice: GameEvent; path: string[] }> = [];
  for (let d = 0; d < depth && level.length > 0; d++) {
    const next: string[] = [];
    for (const r of level) for (const c of store.causesOf(r).map(asEventId).sort()) {
      if (seen.has(c)) continue;
      seen.add(c);
      parent.set(c, r);
      next.push(c);
      const e = store.eventById(c);
      if (e && isPlayerChoice(e)) {
        const path = [c];
        for (let at = c; parent.has(at); ) path.push((at = parent.get(at)!));
        out.push({ choice: e, path });
      }
    }
    level = next;
  }
  return out;
}

function rowTo(r: Record<string, unknown>): Callback {
  return JSON.parse(String(r.data)) as Callback;
}

function save(store: Pick<WorldStore, "sql">, cb: Callback): void {
  store.sql("INSERT INTO callbacks (id, choice, outcome, data, found, told) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, told = excluded.told").run(cb.id, cb.choice, cb.outcome, JSON.stringify(cb), cb.found, cb.told?.day ?? null);
}

export function callbacks(store: Pick<WorldStore, "sql">, o: { pending?: boolean } = {}): Callback[] {
  return (store.sql(`SELECT data FROM callbacks ${o.pending ? "WHERE told IS NULL" : ""} ORDER BY found DESC, id`).all() as Array<Record<string, unknown>>).map(rowTo);
}

/** One day's finding: the notable events of the day (and the ends of stories that grew today) traced back to the player. */
export function findCallbacks(realm: Pick<Realm, "figures">, store: Store, day: number): Callback[] {
  const sinks = new Set((store.sql("SELECT sink FROM stories WHERE last_day = ?").all(day) as Array<{ sink: string }>).map((r) => r.sink));
  const todays = store.eventsOfDay(day);
  const outcomes = [...todays, ...[...sinks].filter((s) => !todays.some((e) => e.id === s)).map((s) => store.eventById(s)).filter((e): e is GameEvent => !!e)];
  const found: Callback[] = [];
  for (const e of outcomes) {
    if (!isNotable(realm, e, sinks) || !e.causedBy?.length) continue;
    const id = `cb:${e.id}`;
    if (store.sql("SELECT 1 FROM callbacks WHERE id = ?").get(id)) continue;
    const behind = choicesBehind(store, e.id);
    // The nearest choice tells best.
    const best = behind.sort((a, b) => a.path.length - b.path.length || (a.choice.id < b.choice.id ? -1 : 1))[0];
    if (!best) continue;
    const cb: Callback = { id, choice: best.choice.id, outcome: e.id, path: best.path, score: e.importance + (DEATHS.has(e.kind) ? 3 : 0), found: day };
    save(store, cb);
    found.push(cb);
  }
  store.sql("DELETE FROM callbacks WHERE told IS NULL AND found < ?").run(day - CALLBACK.keepDays);
  return found;
}

/** Does the player know of this event (saw it, were told, or its news reached them)? */
export function playerKnowsEvent(player: Pick<PlayerState, "known">, e: GameEvent): boolean {
  return e.actor === "player" || e.target === "player" || !!e.knownBy?.includes("player") || !!player.known?.[`e:${e.id}`];
}

/** May this townsperson tell the player this callback? Only if they know both ends themselves (`knows` asks their knowledge). */
export function canTell(cb: Callback, knows: (eventId: string) => boolean): boolean {
  return knows(cb.choice) && knows(cb.outcome);
}

/** Words for the player's choice, as the journal says it ("you spared Odo"). */
function choiceWords(e: GameEvent, nameOf: (id: string) => string): string {
  const who = e.target ? nameOf(e.target) : "someone";
  const W: Record<string, string> = { spared: `spared ${who}`, subdued: `beat ${who} and let them be`, killed: `killed ${who}`, theft: `stole from ${who}`, gift: `gave ${who} a gift`, "promise-kept": `kept your word to ${who}`, "promise-broken": `broke your word to ${who}`, favour: `did ${who} a favour`, rumour: `spread a tale about ${who}`, "quest-done": `did what ${who} asked`, "quest-failed": `failed ${who}`, attacked: `attacked ${who}`, "lied-to": `lied to ${who}`, amends: `made amends with ${who}` };
  return W[e.kind] ?? `${e.kind.replace(/-/g, " ")} (${who})`;
}

/**
 * One day's telling, through the journal: the best pending callback whose outcome the player knows is written down, tying it to their
 * choice. Rate-limited (CALLBACK.perDay; a choice not again within CALLBACK.choiceGap days unless the outcome is a death). Returns those told.
 */
export function tellCallbacks(realm: Realm, store: Store, player: PlayerState, day: number, nameOf: (id: string) => string): Callback[] {
  const told: Callback[] = [];
  const toldToday = Number((store.sql("SELECT COUNT(*) AS n FROM callbacks WHERE told = ?").get(day) as { n: number }).n);
  if (toldToday >= CALLBACK.perDay) return told;
  const recent = callbacks(store).filter((c) => c.told && c.told.day > day - CALLBACK.choiceGap);
  const pending = callbacks(store, { pending: true }).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  for (const cb of pending) {
    if (told.length + toldToday >= CALLBACK.perDay) break;
    const choice = store.eventById(cb.choice);
    const outcome = store.eventById(cb.outcome);
    if (!choice || !outcome || !playerKnowsEvent(player, outcome)) continue;
    if (!DEATHS.has(outcome.kind) && recent.some((r) => r.choice === cb.choice)) continue;
    const text = `You ${choiceWords(choice, nameOf)} on day ${choice.day}; on day ${outcome.day} it came to this: ${outcome.details.replace(/\.$/, "")}.`;
    note(player, { id: cb.id, day, text, kind: "consequence" });
    const site = outcome.site ?? choice.site;
    if (site) recordLifeEvent(realm, store, { kind: "callback-told", actor: "player", site, day, details: text, importance: 1, key: `callback:${cb.outcome}`, causedBy: [cb.outcome, cb.choice] });
    const done: Callback = { ...cb, told: { day, by: "journal" } };
    save(store, done);
    told.push(done);
  }
  return told;
}
