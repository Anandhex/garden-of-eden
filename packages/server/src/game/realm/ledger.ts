import type { PlayerState } from "../../npc/types.js";
import type { Realm } from "./types.js";

/**
 * Coin is moved, never made (plans README section 24, N26F–N26J): every copper that changes hands in the realm goes
 * through `transfer`, and the only places coin comes into being or goes out of it are `mint` (wages and sales to the
 * outside, a mine's yield) and `sink` (upkeep, building, what leaves the realm). Each writes a ledger line, and
 * the realm keeps running totals so the `coin-conserved` bound can check that the realm's coin changed only by
 * what was minted less what was sunk. N69 builds offices and full ledgers on this.
 *
 * A holder is a ref: `s:<settlement>` (its treasury), `f:<faction>` (its wealth), `p:<figure>` (their purse), or
 * `player`. The player is outside the realm's books: coin the player pays in is minted into the realm, coin paid
 * out to the player is sunk out of it (the player's purse isn't part of the world's sum).
 */
export type Holder = string;

/** Ledger lines kept on the realm (the newest). */
export const LEDGER_LINES = 200;

export interface LedgerLine {
  day: number;
  from: Holder | "mint";
  to: Holder | "sink";
  amount: number;
  why: string;
}

export interface CoinBook {
  minted: number;
  sunk: number;
  lines: LedgerLine[];
}

/** The realm's book, made on first use (older realms have none). */
export function bookOf(realm: Realm): CoinBook {
  return (realm.coin ??= { minted: 0, sunk: 0, lines: [] }) as CoinBook;
}

function write(realm: Realm, line: LedgerLine): void {
  const book = bookOf(realm);
  book.lines.push(line);
  if (book.lines.length > LEDGER_LINES) book.lines.splice(0, book.lines.length - LEDGER_LINES);
}

/** What a holder has. */
export function balanceOf(realm: Realm, h: Holder, player?: Pick<PlayerState, "money">): number {
  if (h === "player") return player?.money ?? 0;
  const id = h.slice(2);
  if (h.startsWith("s:")) return realm.settlements[id]?.treasury ?? 0;
  if (h.startsWith("f:")) return realm.factions[id]?.wealth ?? 0;
  if (h.startsWith("p:")) return realm.figures[id]?.wealth ?? 0;
  return 0;
}

function add(realm: Realm, h: Holder, amount: number, player?: Pick<PlayerState, "money">): boolean {
  const id = h.slice(2);
  if (h === "player") {
    if (!player) return false;
    player.money += amount;
    return true;
  }
  if (h.startsWith("s:") && realm.settlements[id]) realm.settlements[id]!.treasury += amount;
  else if (h.startsWith("f:") && realm.factions[id]) realm.factions[id]!.wealth += amount;
  else if (h.startsWith("p:") && realm.figures[id]) realm.figures[id]!.wealth += amount;
  else return false;
  return true;
}

const inRealm = (h: Holder) => h !== "player";

/**
 * Move coin from one holder to another: at most what `from` has. Returns what moved. A holder that doesn't exist
 * can't give or take (nothing moves). Coin between the player and the realm crosses the books' edge (minted or sunk).
 */
export function transfer(realm: Realm, from: Holder, to: Holder, amount: number, why: string, player?: Pick<PlayerState, "money">, day = realm.day): number {
  const want = Math.floor(amount);
  if (want <= 0 || from === to) return 0;
  const moved = Math.min(want, balanceOf(realm, from, player));
  if (moved <= 0) return 0;
  if ((to === "player" && !player) || (to !== "player" && balanceOf(realm, to, player) === 0 && !exists(realm, to))) return 0;
  if (!add(realm, from, -moved, player)) return 0;
  add(realm, to, moved, player);
  const book = bookOf(realm);
  if (!inRealm(from) && inRealm(to)) book.minted += moved;
  if (inRealm(from) && !inRealm(to)) book.sunk += moved;
  write(realm, { day, from, to, amount: moved, why });
  return moved;
}

/** Coin coming into the realm: wages for work, sales to the outside, a mine's yield. */
export function mint(realm: Realm, to: Holder, amount: number, why: string, player?: Pick<PlayerState, "money">, day = realm.day): number {
  const n = Math.floor(amount);
  if (n <= 0 || !add(realm, to, n, player)) return 0;
  if (inRealm(to)) bookOf(realm).minted += n;
  write(realm, { day, from: "mint", to, amount: n, why });
  return n;
}

/** Coin going out of the realm: upkeep, building, goods bought from outside. At most what `from` has. Returns what went. */
export function sink(realm: Realm, from: Holder, amount: number, why: string, player?: Pick<PlayerState, "money">, day = realm.day): number {
  const n = Math.min(Math.floor(amount), balanceOf(realm, from, player));
  if (n <= 0 || !add(realm, from, -n, player)) return 0;
  if (inRealm(from)) bookOf(realm).sunk += n;
  write(realm, { day, from, to: "sink", amount: n, why });
  return n;
}

function exists(realm: Realm, h: Holder): boolean {
  const id = h.slice(2);
  if (h.startsWith("s:")) return !!realm.settlements[id];
  if (h.startsWith("f:")) return !!realm.factions[id];
  if (h.startsWith("p:")) return !!realm.figures[id];
  return false;
}

/**
 * Coin put up for a bounty: taken from a holder and held against the bounty (a pack's, a dungeon's) until it's paid.
 * Bounties are counted in the realm's coin, so this only moves it. Returns what was put up.
 */
export function putUp(realm: Realm, from: Holder, amount: number, why: string, day = realm.day): number {
  const n = Math.min(Math.floor(amount), balanceOf(realm, from));
  if (n <= 0 || !add(realm, from, -n)) return 0;
  write(realm, { day, from, to: `bounty:${why}`, amount: n, why });
  return n;
}

/** A bounty (or other held coin) paid out to a holder. The caller takes it off the bounty. To the player, it leaves the books. */
export function payOut(realm: Realm, to: Holder, amount: number, why: string, player?: Pick<PlayerState, "money">, day = realm.day): number {
  const n = Math.floor(amount);
  if (n <= 0 || !add(realm, to, n, player)) return 0;
  if (!inRealm(to)) bookOf(realm).sunk += n;
  write(realm, { day, from: `bounty:${why}`, to, amount: n, why });
  return n;
}

/** All the realm's coin: treasuries, faction coffers, figures' purses (the dead's too, until it's handed on), and tax on the road. */
export function totalCoin(realm: Realm): number {
  let n = 0;
  for (const s of Object.values(realm.settlements)) n += s.treasury;
  for (const f of Object.values(realm.factions)) n += f.wealth;
  for (const f of Object.values(realm.figures)) n += f.wealth;
  for (const t of realm.transit) n += t.amount;
  for (const p of Object.values(realm.packs)) n += p.bounty;
  for (const d of Object.values(realm.dungeons)) n += d.bounty;
  for (const s of Object.values(realm.settlements)) n += s.stores?.coin ?? 0;
  return n;
}

/** Coin that the books can't account for: the realm's total now, less what it was, less minted, plus sunk. Zero when conserved. */
export function unaccounted(realm: Realm, startTotal: number, start: { minted: number; sunk: number } = { minted: 0, sunk: 0 }): number {
  const book = bookOf(realm);
  return totalCoin(realm) - startTotal - (book.minted - start.minted) + (book.sunk - start.sunk);
}
