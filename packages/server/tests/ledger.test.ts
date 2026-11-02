/**
 * Coin is moved, never made (plans README section 24): `transfer` moves at most what a holder has, `mint` and `sink` are the
 * only ways coin comes into or leaves the realm, and every one writes a ledger line. The realm's total changes only by them.
 */
import { describe, expect, it } from "vitest";
import { generateRealm } from "../src/game/realm/generate.js";
import { bookOf, mint, payOut, putUp, sink, totalCoin, transfer, unaccounted } from "../src/game/realm/ledger.js";

describe("the coin ledger", () => {
  it("transfers move coin without making any, and never more than the payer has", () => {
    const realm = generateRealm(1, 1);
    const [a, b] = Object.values(realm.settlements).filter((s) => !s.way);
    const total = totalCoin(realm);
    const book = { ...bookOf(realm) };
    a!.treasury = 100;
    const t0 = totalCoin(realm);
    expect(transfer(realm, `s:${a!.id}`, `s:${b!.id}`, 250, "a test")).toBe(100);
    expect(a!.treasury).toBe(0);
    expect(totalCoin(realm)).toBe(t0);
    expect(bookOf(realm).lines.at(-1)).toMatchObject({ from: `s:${a!.id}`, to: `s:${b!.id}`, amount: 100, why: "a test" });
    // Nobody to give to: nothing moves.
    expect(transfer(realm, `s:${b!.id}`, "s:nowhere", 10, "lost")).toBe(0);
    void total;
    void book;
  });

  it("mint and sink are the only ways in and out, and the books balance", () => {
    const realm = generateRealm(1, 1);
    const s = Object.values(realm.settlements).find((x) => !x.way)!;
    const start = totalCoin(realm);
    const book = { ...bookOf(realm) };
    mint(realm, `s:${s.id}`, 500, "wages");
    sink(realm, `s:${s.id}`, 120, "upkeep");
    expect(unaccounted(realm, start, book)).toBe(0);
    // A bounty is held coin: putting it up and paying it out to a figure is a move.
    const pack = Object.values(realm.packs)[0]!;
    pack.bounty += putUp(realm, `s:${s.id}`, 60, `pack ${pack.id}`);
    const f = Object.values(realm.figures)[0]!;
    pack.bounty -= payOut(realm, `p:${f.id}`, 60, `pack ${pack.id}`);
    expect(unaccounted(realm, start, book)).toBe(0);
    // Changing coin behind the ledger's back shows up.
    s.treasury += 7;
    expect(unaccounted(realm, start, book)).toBe(7);
  });

  it("the player is outside the books: coin paid in is minted, coin paid out is sunk", () => {
    const realm = generateRealm(1, 1);
    const g = Object.values(realm.factions).find((f) => f.kind === "gang")!;
    const player = { money: 300 };
    const start = totalCoin(realm);
    const book = { ...bookOf(realm) };
    expect(transfer(realm, "player", `f:${g.id}`, 100, "robbed", player)).toBe(100);
    expect(player.money).toBe(200);
    expect(transfer(realm, `f:${g.id}`, "player", 40, "dropped", player)).toBe(40);
    expect(unaccounted(realm, start, book)).toBe(0);
  });
});
