import type { Certainty } from "../../npc/knowledge.js";
import type { NpcState } from "../../npc/types.js";
import type { LifeCtx } from "../people/step.js";
import type { RealmNews } from "../realm/types.js";
import { hearRumour } from "../rumours.js";
import { describeKnown } from "./describe.js";
import { learn } from "./knowledge.js";
import { newsRef, parseRef } from "./refs.js";

/**
 * Talkers and townsfolk are one gossip (N33). A person who becomes a talker keeps their row, so what they knew goes on being theirs:
 * `absorbKnowledge` gives their talking self what their row knows (news told straight becomes lore; a death, or news told with a
 * detail changed, becomes a rumour in the version they heard, with how sure they are), and `shareLore` writes what a talker
 * learned by other means (the news delivered to their place) into their row, so the townsfolk they talk to can hear it from them.
 * Talker pairs go on using `gossipTogether` (game/gossip.ts), which carries more (names, memories).
 */
export interface TalkerHooks {
  /** Make the news lore and learn it at this certainty. */
  news(n: RealmNews, certainty: Certainty): void;
}

/** Give a talker what their row knows. Returns how many things were new to them. */
export function absorbKnowledge(ctx: LifeCtx, personId: string, state: NpcState, day: number, hooks: TalkerHooks): number {
  let fresh = 0;
  for (const row of ctx.store.knowledge.rowsOf(personId)) {
    if (row.learned_day > day) continue;
    const ref = parseRef(row.ref);
    if (!ref) continue;
    if (ref.kind === "n" && row.variant === 0) {
      const news = ctx.realm.news.find((n) => n.id === ref.id);
      if (!news) continue;
      const certainty: Certainty = row.accuracy >= 0.8 ? "certain" : "rumour";
      if (state.learned[`realm.${news.id}`] !== "certain") {
        hooks.news(news, certainty);
        fresh++;
      }
      continue;
    }
    const text = describeKnown(ctx, row.ref, row.accuracy, row.variant);
    if (!text) continue;
    const heardFrom = row.source.startsWith("t_") ? ctx.store.people.get(row.source)?.name : undefined;
    const got = hearRumour(state, {
      about: ref.kind === "d" ? ref.id : "realm",
      fact: ref.kind === "d" ? "death" : ref.id,
      text,
      truth: row.variant === 0 ? "true" : "exaggerated",
      accuracy: row.accuracy,
      ...(heardFrom ? { heardFrom } : {}),
      day: row.learned_day,
      ref: row.ref,
      variant: row.variant,
    });
    if (got) fresh++;
  }
  return fresh;
}

/** Write what a talker knows as lore into their row, where townsfolk can hear it from them. Returns how many rows changed. */
export function shareLore(ctx: LifeCtx, personId: string, state: NpcState, day: number): number {
  let n = 0;
  for (const [id, certainty] of Object.entries(state.learned)) {
    const m = /^realm\.(rn\d+)$/.exec(id);
    if (!m || !ctx.realm.news.some((x) => x.id === m[1]) || ctx.store.knowledge.has(personId, newsRef(m[1]!))) continue;
    if (learn(ctx, personId, newsRef(m[1]!), { day, source: "saw", accuracy: certainty === "certain" ? 1 : 0.7 })) n++;
  }
  return n;
}
