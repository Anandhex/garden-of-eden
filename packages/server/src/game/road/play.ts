import { DAY_ENDS, DAY_STARTS, GROUND_NAMES, Ground, STEPS_PER_GAME_MINUTE, describeWalk, partyAt, shortestWay, type RoadNearby, type RoadView, type RoadPlace } from "@millbrook/shared";
import { absoluteHour, advanceMinutes } from "../clock.js";
import { formatMoney } from "../money.js";
import { itemKey } from "../items.js";
import { streamFor } from "../dice.js";
import type { Town } from "../town.js";
import { weatherOn } from "../weather.js";
import { camp, hoursToMorning } from "./camp.js";
import { robCaravan, travelWith } from "./caravans.js";
import { quoteCoach, takeCoach } from "./coach.js";
import { canFast, fastTravel } from "./fast.js";
import { groundAt, landOf, nearestRoad, placesNear } from "./ground.js";
import { hudOf } from "./hud.js";
import { journeyOf, journeysNear, lineOf } from "./journeys.js";
import { buyMount, feedMount, mountStep, mountView, sellMount, tickMount, treatMount } from "./mounts.js";
import { consume, drink, needsOf, needsWords, stepPenalty, tickNeeds, topUp } from "./needs.js";
import { meet, resolve, viewOf } from "./situations.js";
import { meetThreats } from "./threats.js";
import { stepOnRoad } from "./walk.js";
import type { MountKind } from "./state.js";

/** What taking a step on the road comes to. */
export interface StepOutcome {
  ok: boolean;
  reason?: string;
  /** Lines for the log. */
  log: string[];
  /** The player reached a settlement's gate and is now in it. */
  entered?: string;
}

/** How much longer a step takes in the day's weather (N26 C3): rain slows, snow slows more, a storm says stay. */
const WEATHER_SLOW: Record<string, number> = { clear: 1, cloudy: 1, fog: 1.1, rain: 1.2, storm: 1.4, snow: 1.5 };

/** Food a farm will sell, and its price in copper. */
const FARM_FOOD = 4;

/**
 * Everything the player does on the open road (N26), for one town: the step, what's near, what the header says, camps,
 * supplies, mounts, fast travel and coaches. It works on `town.world` and `town`, so a test can walk a road with no
 * server, and the server only carries the request in and the answer out. `pass` is how the world lives game minutes
 * while walking (the server passes its `walkMinutes`, which also moves the creatures on screen).
 */
export class RoadPlay {
  constructor(private readonly town: Town) {}

  private get world() {
    return this.town.world;
  }

  /** The player is walking between places. */
  onRoad(): boolean {
    return !!this.world.player.road && !!this.world.realm;
  }

  /** The game minute now. */
  minute(): number {
    return (this.world.day - 1) * 1440 + this.world.hour * 60 + (this.world.minute ?? 0);
  }

  /** The step, then the minute that passes (and what it does to a body), then what's met. */
  step(dx: number, dy: number, pass: (minutes: number) => string[] = (m) => this.town.walkMinutes(m)): StepOutcome {
    const realm = this.world.realm;
    const p = this.world.player;
    if (!realm || !p.road) return { ok: false, reason: "You're not on the road.", log: [] };
    if (p.road.pending) return { ok: false, reason: "Something needs your decision first.", log: [] };
    const r = stepOnRoad(realm, p, dx, dy, this.world.day, this.cost());
    if (!r.ok) return { ok: false, ...(r.reason ? { reason: r.reason } : {}), log: r.lines };
    const log = [...r.lines];
    if (r.entered) {
      log.push(...this.town.arriveAt(r.entered));
      topUp(p, this.minute(), 60);
      return { ok: true, log, entered: r.entered };
    }
    if (r.minute) {
      // The place they left lives its hour without them (its gossip is not theirs to hear).
      pass(1);
      const m = this.minute();
      log.push(...tickNeeds(p, 1, m, { weather: weatherOn(this.world.day) }));
      log.push(...tickMount(p, 1 / 60, { riding: true, rng: streamFor(this.world.seed, "mount", this.world.day, this.world.hour, m) }));
      if (needsOf(p, m).rest <= 0) log.push("You can't go another step.", ...this.camp(6));
    }
    const land = landOf(realm);
    // What waits here: a pack's ground, an ambush, then something on this stretch of road today.
    if (!p.road) return { ok: true, log };
    log.push(...meetThreats(this.town, this.town.actionRng()));
    const near = nearestRoad(land, p.road, 10);
    if (near && !near.road.id.startsWith("spur:")) log.push(...meet(this.town, land.data, near.road, near.t));
    return { ok: true, log };
  }

  /** The player chooses what to do about what's on the road. */
  choose(choiceId: string): { ok: boolean; lines: string[] } {
    return resolve(this.town, choiceId, this.minute());
  }

  /**
   * Say where the player is bound (a settlement id or name). From a place, they walk out of its gate onto the road
   * toward it; on the road, the header counts the way to it. The walk itself is the player's. `leave` puts them on the road.
   */
  setDestination(to: string, leave: (toward?: string) => string[]): { ok: boolean; lines: string[] } {
    const realm = this.world.realm;
    const p = this.world.player;
    if (!realm) return { ok: false, lines: ["There's no wider realm in this world."] };
    const want = to.trim().toLowerCase();
    const dest = realm.settlements[to] ?? Object.values(realm.settlements).find((s) => !s.way && (s.name.toLowerCase() === want || s.name.toLowerCase().startsWith(want)));
    if (!dest || dest.way) return { ok: false, lines: [`There's no place called "${to}".`] };
    if (dest.abandoned) return { ok: false, lines: [`${dest.name} stands empty; there's nobody to go to.`] };
    if (p.hp <= p.maxHp * 0.25) return { ok: false, lines: ["You're in no state for the road. Rest first."] };
    const data = landOf(realm).data;
    const from = p.road ? p.road.from : this.town.site();
    if (!p.road && dest.id === from) return { ok: false, lines: [`You're already in ${dest.name}.`] };
    const way = shortestWay(data, from, dest.id);
    if (!way) return { ok: false, lines: [`No road leads from ${realm.settlements[from]?.name ?? "here"} to ${dest.name}.`] };
    const via = way.path.slice(1, -1).map((id) => realm.settlements[id]?.name).filter(Boolean);
    const lines = [`${dest.name} is ${describeWalk(way.tiles)} away by road${via.length > 0 ? `, by way of ${via.join(", ")}` : ""}.`];
    if (p.road) p.road.dest = dest.id;
    else lines.unshift(...leave(dest.id));
    return { ok: true, lines };
  }

  /** Where one of a journey's party stands now (whole tiles), or null if they aren't on the road (home, or in a town visiting). */
  travellerPos(id: string): { x: number; y: number } | null {
    const realm = this.world.realm;
    const at = this.town.whereNow(id);
    if (!realm || !at) return null;
    const j = journeyOf(realm, at.journey);
    if (!j || !this.visibleOnRoad(j, at.site)) return null;
    const m = this.minute();
    if (m < j.depart || m >= (j.ended ? Math.min(j.ended.minute, j.arrive) : j.arrive)) return null;
    const p = partyAt(j, lineOf(landOf(realm).data, j), m)[j.party.findIndex((t) => t.person === id)];
    return p ? { x: p.x, y: p.y } : null;
  }

  /** On the road, or resting at an inn beside it: seen from the road. (In a town, they are in its crowd.) */
  private visibleOnRoad(_j: unknown, site: string | null): boolean {
    return site === null || !!this.world.realm?.settlements[site]?.way;
  }

  /** The people of the journeys near the player (within `radius` tiles): ids of the `people` table, to talk to. */
  travellersNear(radius = 40): string[] {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road) return [];
    const out: string[] = [];
    for (const { journey } of journeysNear(realm, landOf(realm).data, road, radius + 10, this.minute())) for (const t of journey.party) if (this.travellerPos(t.person)) out.push(t.person);
    return out;
  }

  /** The journeys within `radius` of the player, in full, for the browser to place (it makes positions the same way the server does). */
  journeysForClient(radius = 900): { minute: number; journeys: unknown[] } {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road) return { minute: this.minute(), journeys: [] };
    const m = this.minute();
    // On the road now, or setting out within the hour.
    const near = journeysNear(realm, landOf(realm).data, road, radius, m + 60).map((x) => x.journey);
    return { minute: m, journeys: near };
  }

  /** Steps one tile costs: walking is 1; a mount is quicker; weariness, hunger and bad weather slow it. */
  cost(): number {
    const p = this.world.player;
    return mountStep(p.mount) * stepPenalty(needsOf(p, this.minute())) * WEATHER_SLOW[weatherOn(this.world.day)]!;
  }

  /** Go along with a party on the road to where it is going. */
  travelWith(journey: string): { ok: boolean; lines: string[] } {
    return travelWith(this.town, journey);
  }

  rob(journey: string): { ok: boolean; lines: string[] } {
    return robCaravan(this.town, journey);
  }

  // ---- Camp, supplies, mounts ----

  /** Sleep in the open. Default: until morning. */
  camp(hours = hoursToMorning(this.world.hour)): string[] {
    if (!this.onRoad()) return ["You're not on the road."];
    return camp(this.town, Math.max(1, Math.min(12, Math.round(hours))), this.minute());
  }

  eat(item: string): string[] {
    const p = this.world.player;
    const r = consume(p, item, this.minute());
    return [r.message];
  }

  /** Drink from water near (a river, a pond) or at a farm or shrine's well. */
  drinkHere(): string[] {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road) return ["There's nothing to drink from here."];
    const land = landOf(realm);
    let water = false;
    for (let dy = -2; dy <= 2 && !water; dy++) for (let dx = -2; dx <= 2 && !water; dx++) water = groundAt(land, road.x + dx, road.y + dy) === Ground.water;
    const well = placesNear(land, road, 6).some((x) => x.kind === "farmstead" || x.kind === "shrine");
    if (!water && !well) return ["There's no water close enough to drink."];
    return [drink(this.world.player, this.minute())];
  }

  mount(op: "buy" | "sell" | "feed" | "treat", arg: string): string[] {
    const p = this.world.player;
    if (op !== "feed" && this.onRoad() && op !== "sell") return ["You can see to a mount in a town or village."];
    const rng = this.town.actionRng();
    const r = op === "buy" ? buyMount(p, arg === "cart" ? ("cart" as MountKind) : ("horse" as MountKind), this.town.site(), rng) : op === "sell" ? sellMount(p) : op === "feed" ? feedMount(p, arg || "turnips") : treatMount(p);
    return [r.message];
  }

  // ---- Fast travel and coaches ----

  fast(): string[] {
    return fastTravel(this.town, this.minute()).lines;
  }

  coach(to: string): { ok: boolean; lines: string[] } {
    return takeCoach(this.town, to, this.minute());
  }

  coachQuote(to: string) {
    return quoteCoach(this.town, to, this.minute());
  }

  // ---- Things beside the road ----

  private offersOf(pl: RoadPlace, today: number): Array<{ op: string; label: string }> {
    const paid = this.world.player.road?.paid[`use:${pl.id}`] === today;
    switch (pl.kind) {
      case "shrine":
        return [{ op: "pray", label: paid ? "Pray (again)" : "Pray" }, { op: "drink", label: "Drink from the well" }];
      case "farmstead":
        return [{ op: "buy", label: `Buy bread and milk (${formatMoney(FARM_FOOD)})` }, { op: "drink", label: "Ask for water" }];
      case "milestone":
      case "signpost":
      case "waystation":
        return [{ op: "read", label: pl.kind === "milestone" ? "Read the stone" : "Read the sign" }];
      default:
        return [];
    }
  }

  /** Use a place beside the road: pray at a shrine, buy from a farm, read a stone. */
  usePlace(id: string, op: string): string[] {
    const realm = this.world.realm;
    const p = this.world.player;
    const road = p.road;
    if (!realm || !road) return ["You're not on the road."];
    const land = landOf(realm);
    const pl = placesNear(land, road, 8).find((x) => x.id === id);
    if (!pl) return ["That is out of reach."];
    const today = this.world.day;
    const m = this.minute();
    if (op === "read") {
      const hud = hudOf(realm, p);
      const ends = (hud?.ends ?? []).map((e) => `${e.name} ${e.walk}`).join("; ");
      return [`${pl.kind === "waystation" ? `A sign: ${pl.name}, an inn, down the lane.` : `Carved on it, worn: ${ends || "the road goes on"}.`}`];
    }
    if (op === "drink") return [drink(p, m)];
    if (pl.kind === "shrine" && op === "pray") {
      if (road.paid[`use:${pl.id}`] === today) return ["You've prayed here today."];
      road.paid[`use:${pl.id}`] = today;
      const n = needsOf(p, m);
      n.rest = Math.min(100, n.rest + 12);
      p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.round(p.maxHp * 0.1)));
      return ["You kneel a while at the shrine. The quiet does you good."];
    }
    if (pl.kind === "farmstead" && op === "buy") {
      if (p.money < FARM_FOOD) return [`The farmwife wants ${formatMoney(FARM_FOOD)}.`];
      p.money -= FARM_FOOD;
      const n = needsOf(p, m);
      n.food = Math.min(100, n.food + 28);
      n.water = Math.min(100, n.water + 18);
      return [`You buy bread and a mug of milk for ${formatMoney(FARM_FOOD)}.`];
    }
    return ["Nothing to be done here."];
  }

  private fastMemo = new Map<string, boolean>();

  /** Fast travel is on offer (memoised: working out the route is more than a step should cost). */
  private fastOk(where: string): boolean {
    const p = this.world.player;
    const key = `${where}|${p.road?.dest}|${(p.walked ?? []).length}`;
    let v = this.fastMemo.get(key);
    if (v === undefined) {
      v = canFast(this.town);
      this.fastMemo.set(key, v);
      if (this.fastMemo.size > 100) this.fastMemo.delete(this.fastMemo.keys().next().value!);
    }
    return v;
  }

  /** The header and what's near, for the snapshot. */
  view(): RoadView | null {
    const realm = this.world.realm;
    const p = this.world.player;
    if (!realm || !p.road) return null;
    const land = landOf(realm);
    const hud = hudOf(realm, p);
    const g = groundAt(land, p.road.x, p.road.y);
    const near = nearestRoad(land, p.road, 10);
    const today = this.world.day;
    const nearby: RoadNearby[] = placesNear(land, p.road, 6).map((pl) => ({ id: pl.id, kind: pl.kind, name: pl.name, x: pl.at.x, y: pl.at.y, offers: this.offersOf(pl, today) }));
    const m = this.minute();
    const needs = needsOf(p, m);
    const minuteOfDay = this.world.hour * 60 + (this.world.minute ?? 0);
    return {
      where: hud?.where ?? "the open country",
      off: hud?.off ?? null,
      ends: hud?.ends ?? [],
      dest: hud?.dest ?? null,
      inn: hud?.inn ?? null,
      ground: GROUND_NAMES[g] ?? "ground",
      walked: !!near && (p.walked ?? []).some((s) => s.startsWith(`${near.road.id}#`)),
      canFast: !!p.road.dest && this.fastOk(near ? `${near.road.id}:${Math.floor(near.t / 300)}` : "off"),
      needs: { food: Math.round(needs.food), water: Math.round(needs.water), rest: Math.round(needs.rest), words: needsWords(needs) },
      mount: mountView(p.mount),
      pending: viewOf(realm, land.data, this.town),
      nearby,
      stepsPerMinute: STEPS_PER_GAME_MINUTE,
      lightLeft: minuteOfDay >= DAY_STARTS * 60 && minuteOfDay < DAY_ENDS * 60 ? DAY_ENDS * 60 - minuteOfDay : null,
    };
  }
}

export { advanceMinutes, absoluteHour, itemKey };
