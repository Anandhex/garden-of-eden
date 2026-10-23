import { describe, expect, it } from "vitest";
import { seededRng } from "../src/game/dice.js";
import { WorldStore } from "../src/game/db.js";
import { advanceRealm } from "../src/game/realm/day.js";
import { killFigure } from "../src/game/realm/figures.js";
import { generateRealm } from "../src/game/realm/generate.js";
import { courtDay, courtSeats } from "../src/game/realm/politics.js";
import type { Realm } from "../src/game/realm/types.js";
import { realmView } from "../src/game/realm/view.js";
import { materialisePeople } from "../src/store/materialise.js";

/** Living crown members of a kingdom with this role at this place. */
const seated = (realm: Realm, site: string, role: string): number => {
  const crown = realm.factions[realm.kingdoms[realm.settlements[site]!.kingdom!]!.crown]!;
  return crown.members.filter((m) => realm.figures[m]?.alive && realm.figures[m]!.home === site && realm.figures[m]!.role === role).length;
};

describe("crowns keep their courts", () => {
  it("a new world seats a noble and a captain at the capital and city, a captain at each town", () => {
    const realm = generateRealm(1, 1);
    for (const s of Object.values(realm.settlements)) for (const role of courtSeats(s)) expect(seated(realm, s.id, role), `${s.name} ${role}`).toBeGreaterThan(0);
  });

  it("dead nobles and captains are replaced, sworn to the crown", () => {
    const realm = generateRealm(1, 1);
    const k = Object.values(realm.kingdoms)[0]!;
    const crown = realm.factions[k.crown]!;
    const court = crown.members.map((m) => realm.figures[m]!).filter((f) => f.role === "noble" || f.role === "captain");
    expect(court.length).toBeGreaterThan(0);
    for (const f of court) killFigure(realm, f, 2, "a fever");
    const rng = seededRng(7);
    for (let d = 2; d < 40; d++) courtDay(realm, d, rng);
    for (const s of Object.values(realm.settlements).filter((x) => x.kingdom === k.id)) for (const role of courtSeats(s)) expect(seated(realm, s.id, role), `${s.name} ${role}`).toBe(1);
    expect(realm.news.some((n) => n.kind === "court")).toBe(true);
    expect((realm.stats.court ?? 0)).toBeGreaterThanOrEqual(court.length);
  });

  it("a filled court is left alone", () => {
    const realm = generateRealm(2, 1);
    const before = Object.keys(realm.figures).length;
    courtDay(realm, 2, () => 0);
    expect(Object.keys(realm.figures).length).toBe(before);
    expect(realm.stats.court ?? 0).toBe(0);
  });

  it("over a year the crowns don't wither to a handful", () => {
    const realm = generateRealm(3, 1);
    advanceRealm(realm, 49, seededRng(3));
    for (const k of Object.values(realm.kingdoms)) {
      const crown = realm.factions[k.crown]!;
      if (crown.dissolved) continue;
      expect(crown.members.filter((m) => realm.figures[m]?.alive).length, crown.name).toBeGreaterThanOrEqual(6);
    }
  });

  it("a crown's size counts the townsfolk sworn to it, not only its named members", () => {
    const realm = generateRealm(1, 1);
    const store = new WorldStore(":memory:");
    materialisePeople(realm, store.people, 1);
    const sworn = store.people.swornByFaction();
    const view = realmView(realm, { sworn });
    for (const k of Object.values(realm.kingdoms)) {
      const f = view.factions.find((x) => x.id === k.crown)!;
      expect(f.named).toBe(realm.factions[k.crown]!.members.length);
      expect(f.sworn).toBeGreaterThan(f.named * 5);
      expect(f.size).toBe(f.named + f.sworn);
    }
    // A sworn townsperson who dies is no longer counted (before the change is written, and after).
    const k = Object.values(realm.kingdoms)[0]!;
    const crownId = k.crown;
    const row = (store.people.loadSite(k.capital) as Array<{ id: string; faction: string | null; figure: string | null }>).find((r) => r.faction === crownId && r.figure === null)!;
    store.people.update(row.id, { death: JSON.stringify({ cause: "fever", day: 2 }) });
    expect(store.people.swornByFaction().get(crownId)).toBe(sworn.get(crownId)! - 1);
    store.people.flush(1);
    expect(store.people.swornByFaction().get(crownId)).toBe(sworn.get(crownId)! - 1);
  });

  it("without the people store, size is the named members as before", () => {
    const realm = generateRealm(1, 1);
    for (const f of realmView(realm).factions) expect(f.size).toBe(f.named);
  });
});
