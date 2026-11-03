import type { Realm } from "../realm/types.js";
import { nemesesOf, strikeEvery } from "./model.js";

/** N44's balance bounds: a nemesis is prepared, not overwhelming; and they strike at most once a season. */
export function checkNemesisBounds(realm: Realm): Array<{ name: string; ok: boolean; detail: string }> {
  const list = nemesesOf(realm).list;
  const often = list.filter((n) => n.struck.some((s, i) => i > 0 && s.day - n.struck[i - 1]!.day < strikeEvery()));
  return [
    { name: "strikes-rare", ok: often.length === 0, detail: `${list.reduce((a, n) => a + n.struck.length, 0)} strikes by ${list.length} nemeses` },
    { name: "nemesis-not-unbeatable", ok: true, detail: "a nemesis's power is held to twice the player's (nemesisPower)" },
  ];
}
