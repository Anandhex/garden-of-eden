import { DAY_ENDS, DAY_STARTS, GROUND_NAMES, Ground, STEPS_PER_GAME_MINUTE, describeWalk, partyAt, shortestWay, type RoadNearby, type RoadView, type RoadPlace } from "@millbrook/shared";
import { absoluteHour, advanceMinutes } from "../clock.js";
import { formatMoney } from "../money.js";
import { itemKey } from "../items.js";
import { streamFor } from "../dice.js";
import type { Town } from "../town.js";
import { weatherOn, whereOf } from "../weather.js";
import { camp, hoursToMorning } from "./camp.js";
import { robCaravan, travelWith } from "./caravans.js";
import { quoteCoach, takeCoach } from "./coach.js";
import { canFast, fastTravel, learnRoadsNear } from "./fast.js";
import { groundAt, landOf, nearestRoad, placesNear } from "./ground.js";
import { hudOf } from "./hud.js";
import { journeyOf, journeysNear, lineOf } from "./journeys.js";
import { buyMount, feedMount, mountStep, mountView, sellMount, tickMount, treatMount } from "./mounts.js";
import { consume, drink, needsOf, needsWords, stepPenalty, tickNeeds, topUp } from "./needs.js";
import { meet, resolve, viewOf } from "./situations.js";
import { answerToll, hostilesStep, stockTerritory } from "./hostiles.js";
import { commutersNear } from "./commute.js";
import { plotUnder } from "../farm/fields.js";
import { playerReaps, plotTiles } from "../farm/day.js";
import { passSigns, signsNear } from "./signs.js";
import { hireOn, SELLSWORD_WAGE } from "./watch.js";
import { campsNear, minersWords, searchWreck, useOldPlace, wrecksNear } from "./roadside.js";
import type { AreaId } from "../schedule.js";
import { stepOnRoad } from "./walk.js";
import { territoriesAt } from "./territories.js";
import { config } from "../../config.js";
import { closedOn, highRoadWords } from "./snow.js";
import { fish, gatherPlant, noteNear, plantsNear, signsNear as natureSigns, track, useWildItem } from "../nature/wild.js";
import { MAP_PRICE, buyMap, driftStep, hearOfPlaces, inWilds, lostHour, spotPlaces, statePois, useWild, wildNearby } from "./wildPlaces.js";
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
    const was = { x: p.road.x, y: p.road.y };
    // Lost in the wilds (N27), a step can go astray.
    ({ dx, dy } = driftStep(this.town, dx, dy));
    const r = stepOnRoad(realm, p, dx, dy, this.world.day, this.cost());
    if (!r.ok) return { ok: false, ...(r.reason ? { reason: r.reason } : {}), log: r.lines };
    const log = [...r.lines];
    // Banished from it (N26J): the guards at the gate turn the player away until the day it ends.
    const until = r.entered ? p.banished?.[r.entered] : undefined;
    if (r.entered && until !== undefined && this.world.day < until && p.road) {
      p.road.x = was.x;
      p.road.y = was.y;
      return { ok: false, reason: `The guards at the gate of ${realm.settlements[r.entered]?.name} turn you away: you're banished until day ${until}.`, log };
    }
    if (r.entered) {
      log.push(...this.town.arriveAt(r.entered));
      topUp(p, this.minute(), 60);
      return { ok: true, log, entered: r.entered };
    }
    if (r.minute) {
      // The place they left lives its hour without them (its gossip is not theirs to hear).
      pass(1);
      const m = this.minute();
      log.push(...tickNeeds(p, 1, m, { weather: weatherOn(this.world.day, whereOf(this.world)) }));
      // The wilds are harder going than the road (N27): needs fall a quarter faster off it.
      const wild = inWilds(this.town);
      if (wild && m % 4 === 0) log.push(...tickNeeds(p, 1, m, { weather: weatherOn(this.world.day, whereOf(this.world)) }));
      // Once a game hour off the road: losing the way, or finding it.
      const hourKey = `${this.world.day}:${this.world.hour}`;
      if (this.lostKey !== hourKey && (wild || p.map?.lost)) {
        this.lostKey = hourKey;
        log.push(...lostHour(this.town));
      }
      log.push(...tickMount(p, 1 / 60, { riding: true, rng: streamFor(this.world.seed, "mount", this.world.day, this.world.hour, m) }));
      if (needsOf(p, m).rest <= 0) log.push("You can't go another step.", ...this.camp(6));
    }
    const land = landOf(realm);
    // What waits here: a pack's ground, an ambush, then something on this stretch of road today.
    if (!p.road) return { ok: true, log };
    // Packs and gangs on their stretches of road come out, on the map (N26F step 2).
    log.push(...hostilesStep(this.town, this.town.actionRng()));
    log.push(...passSigns(this.town));
    log.push(...spotPlaces(this.town));
    log.push(...noteNear(this.town));
    log.push(...this.lairAtNight());
    log.push(...this.trample());
    const near = nearestRoad(land, p.road, 10);
    if (near && !near.road.id.startsWith("spur:")) log.push(...meet(this.town, land.data, near.road, near.t));
    return { ok: true, log };
  }

  /** Too near a pack's lair at night (N27): they come out (once a day). */
  private lairAtNight(): string[] {
    const realm = this.world.realm;
    const road = this.world.player.road;
    const h = this.world.hour;
    if (!realm || !road || !(h >= 20 || h < 5)) return [];
    const lair = statePois(realm, landOf(realm).data).find((x) => x.kind === "lair" && Math.abs(x.x - road.x) <= 30 && Math.abs(x.y - road.y) <= 30 && Math.hypot(x.x - road.x, x.y - road.y) <= 30);
    if (!lair || road.met[lair.id] === this.world.day) return [];
    const pack = realm.packs[lair.ref];
    if (!pack || pack.count <= 0) return [];
    road.met[lair.id] = this.world.day;
    const made = stockTerritory(this.town, { id: lair.id, kind: "pack", owner: pack.id, road: "", t0: 0, t1: 0, width: 0, near: pack.near }, this.town.actionRng());
    return made.length > 0 ? [`Eyes in the dark: you've come too near a ${pack.species}s' lair, and they're out hunting.`] : [];
  }

  private lostKey = "";

  /** Walking through a standing crop tramples it (N26G decision 6): a field event by the player, on that tile. */
  private trample(): string[] {
    const realm = this.world.realm;
    const p = this.world.player.road;
    const store = this.town.store;
    if (!realm || !p || !store) return [];
    const under = plotUnder(realm, store, p.x, p.y, this.world.day);
    if (!under) return [];
    const stage = plotTiles(realm, store, under.s, under.plot, this.world.day)[under.i] ?? 0;
    if (stage === 0 || stage >= 6) return [];
    store.farm.record(under.s.id, { plot: under.plot.id, day: this.world.day, kind: "trample", tiles: [under.i], by: "player", amount: 1 });
    const key = `trample:${under.plot.id}`;
    if (p.seen[key] === this.world.day) return [];
    p.seen[key] = this.world.day;
    const holder = under.row?.holder ?? "commons";
    const whose = holder.startsWith("hh:") ? "someone's" : holder.startsWith("lord:") ? "the lord's" : holder.startsWith("temple:") ? "the temple's" : "the village's";
    return [`You're trampling ${whose} crop.`];
  }

  /** A plot next to where the player stands (one tile either way). */
  private besidePlot() {
    const realm = this.world.realm;
    const p = this.world.player.road;
    if (!realm || !p || !this.town.store) return null;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const hit = plotUnder(realm, this.town.store, p.x + dx, p.y + dy, this.world.day);
      if (hit) return hit;
    }
    return null;
  }

  /** The player chooses what to do about what's on the road. */
  choose(choiceId: string): { ok: boolean; lines: string[] } {
    if (this.world.player.road?.pending?.kind === "toll") return answerToll(this.town, choiceId);
    return resolve(this.town, choiceId, this.minute());
  }

  /** A gang's toll waiting for an answer, as a situation to show. */
  private tollView(): RoadView["pending"] {
    const pend = this.world.player.road?.pending;
    if (!pend || pend.kind !== "toll") return null;
    const g = this.world.realm?.factions[pend.id];
    const p = this.world.player;
    return {
      id: pend.key,
      title: `${g?.name ?? "Outlaws"} on the road`,
      text: `They want ${formatMoney(pend.amount)} to let you by.`,
      choices: [
        { id: "pay", label: `Pay ${formatMoney(pend.amount)}`, ...(p.money < pend.amount ? { hint: `You need ${formatMoney(pend.amount)}.` } : {}) },
        { id: "refuse", label: "Refuse, and fight if it comes to it" },
        { id: "back", label: "Turn back" },
      ],
    };
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
    const shut = closedOn(realm, data, this.world.day);
    const way = shortestWay(data, from, dest.id, undefined, shut);
    if (!way) {
      const anyWay = shut.size > 0 && shortestWay(data, from, dest.id);
      return { ok: false, lines: [anyWay ? `The way to ${dest.name} is snowed in over the hills. Wait for the thaw, or go another way when one opens.` : `No road leads from ${realm.settlements[from]?.name ?? "here"} to ${dest.name}.`] };
    }
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
    // Someone walking to work along the road (N26F decision 12): where their day has them.
    if (realm && !at) {
      const c = commutersNear(this.town, 200).find((x) => x.person === id);
      return c ? { x: c.x, y: c.y } : null;
    }
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
    for (const c of commutersNear(this.town, radius)) out.push(c.person);
    return out;
  }

  /** Steps one tile costs: walking is 1; a mount is quicker; weariness, hunger and bad weather slow it. */
  cost(): number {
    const p = this.world.player;
    return mountStep(p.mount) * stepPenalty(needsOf(p, this.minute())) * WEATHER_SLOW[weatherOn(this.world.day, whereOf(this.world))]!;
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
    // Something gathered with an effect (N28) is eaten for what it is (what it really is).
    const wild = useWildItem(this.town, item, "eaten");
    if (!/^You can't eat|^You have no/.test(wild[0] ?? "")) return [wild.join(" ")];
    const r = consume(p, item, this.minute());
    return [r.message];
  }

  /** Water within `r` tiles of the player. */
  private waterNear(r: number): boolean {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road) return false;
    const land = landOf(realm);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (groundAt(land, road.x + dx, road.y + dy) === Ground.water) return true;
    return false;
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
        return [{ op: "buy", label: `Buy bread and milk (${formatMoney(FARM_FOOD)})` }, { op: "drink", label: "Ask for water" }, { op: "ask", label: "Ask about the country round" }];
      case "waystation":
        return [{ op: "read", label: "Read the sign" }, { op: "ask", label: "Ask at the inn about the country round" }, { op: "buymap", label: `Buy a map of the country (${formatMoney(MAP_PRICE)})` }];
      case "milestone":
      case "signpost":
        return [{ op: "read", label: pl.kind === "milestone" ? "Read the stone" : "Read the sign" }];
      case "woods":
        return [{ op: "enter", label: "Take the path into the woods" }];
      case "mine": {
        if (pl.area) return [{ op: "enter", label: "Go up the track to the mine" }];
        const watch = pl.site ? this.world.realm?.settlements[pl.site]?.watch : undefined;
        return [{ op: "look", label: "Look at the mine" }, ...(watch && watch.level > 0 && this.world.player.duty?.day !== today ? [{ op: "hire", label: `Take a day on the mine watch (${formatMoney(SELLSWORD_WAGE)})` }] : [])];
      }
      case "camp":
        return [{ op: "enter", label: "Go into the camp" }];
      case "stones":
        return [{ op: "look", label: "Look at the stones" }];
      case "ruin":
      case "cave":
        return [{ op: "search", label: pl.kind === "cave" ? "Go in and look about" : "Search the ruin" }];
      case "herbs":
        return [{ op: "gather", label: "Gather herbs" }];
      case "ore":
        return [{ op: "dig", label: "Dig ore (needs a pick)" }];
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
    if (id.startsWith("wreck:")) return searchWreck(this.town, id);
    // Fauna and flora (N28): a plant patch, an animal's sign, the water to fish.
    if (id.startsWith("f:")) return gatherPlant(this.town, id);
    if (id.startsWith("sg:")) return track(this.town, id);
    if (id === "water" && op === "fish") return fish(this.town);
    // A place in the wilds (N27): seeded, or from the realm.
    if (/^(w|lair|dungeon|abandoned|battle):/.test(id)) return useWild(this.town, id, op, this.minute());
    if (id.startsWith("plot:") && op === "reap" && this.town.store) {
      const under = plotUnder(realm, this.town.store, road.x, road.y, this.world.day) ?? this.besidePlot();
      if (!under || `plot:${under.plot.id}` !== id) return ["That is out of reach."];
      return playerReaps(realm, this.town.store, under.s.id, under.plot.id, this.world.day, this.world.player);
    }
    // A gang's camp, once the player knows where it is (N26F decision 9): the camp map, entered from here.
    if (id.startsWith("camp:")) {
      const camp = campsNear(this.town, 10).find((c) => c.id === id);
      if (!camp) return ["That is out of reach."];
      return this.town.enterFromRoad(camp.seat, "road");
    }
    const land = landOf(realm);
    const pl = placesNear(land, road, 8).find((x) => x.id === id);
    if (!pl) return ["That is out of reach."];
    const today = this.world.day;
    const m = this.minute();
    // An innkeeper or a farmer tells of the country round; the inn sells maps of it (N27).
    if (op === "ask" && (pl.kind === "waystation" || pl.kind === "farmstead")) {
      if (road.paid[`ask:${pl.id}`] === today) return ["You've asked here today already."];
      road.paid[`ask:${pl.id}`] = today;
      // At an inn they tell you the way: the road it stands on, and the roads that meet near it (N26 Part C1).
      const roads = pl.kind === "waystation" ? learnRoadsNear(p, land.data, pl.at, 600) : 0;
      return [...hearOfPlaces(this.town, pl.at), ...(roads > 0 ? [`They tell you the way along ${roads === 1 ? "the road" : `${roads} roads`} from here: you could travel ${roads === 1 ? "it" : "them"} quickly now.`] : [])];
    }
    if (op === "buymap" && pl.kind === "waystation") return buyMap(this.town, pl.at, pl.site ? `s:${pl.site}` : "");
    if (op === "read") {
      const hud = hudOf(realm, p, this.world.day);
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
    if (op === "enter" && pl.area) return this.town.enterFromRoad(pl.area.site, pl.area.id as AreaId);
    if (pl.kind === "mine" && op === "hire" && pl.site) return hireOn(this.town, pl.site);
    if (pl.kind === "mine" && op === "look") return [`${pl.name}: spoil heaps, a winch, the dark of the adit. ${minersWords(this.town, pl.site ?? "")}`];
    if (["stones", "ruin", "cave", "herbs", "ore"].includes(pl.kind)) return useOldPlace(this.town, pl, op, m);
    return ["Nothing to be done here."];
  }

  private fastMemo = new Map<string, boolean>();

  /** Fast travel is on offer (memoised: working out the route is more than a step should cost). */
  private fastOk(where: string): boolean {
    const p = this.world.player;
    const key = `${where}|${p.road?.dest}|${(p.walked ?? []).length}|${(p.knownRoads ?? []).length}`;
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
    const hud = hudOf(realm, p, this.world.day);
    const g = groundAt(land, p.road.x, p.road.y);
    const near = nearestRoad(land, p.road, 10);
    const today = this.world.day;
    const nearby: RoadNearby[] = placesNear(land, p.road, 6).map((pl) => ({ id: pl.id, kind: pl.kind, name: pl.name, x: pl.at.x, y: pl.at.y, offers: this.offersOf(pl, today) }));
    // A gang's camp, only once the player knows of it (it's never in the road data the browser has: N27's rule for secret places).
    for (const c of campsNear(this.town, 8)) nearby.push({ id: c.id, kind: "camp", name: c.name, x: c.x, y: c.y, offers: [{ op: "enter", label: "Go into the camp" }] });
    // Places in the wilds the player knows, within reach (N27).
    nearby.push(...wildNearby(this.town));
    // Plants to gather, signs to follow, water to fish (N28).
    for (const pl of plantsNear(this.town, 3)) if (pl.ready) nearby.push({ id: pl.id, kind: "plant", name: pl.name, x: pl.x, y: pl.y, offers: [{ op: "gather", label: `Gather ${pl.name}` }] });
    for (const sg of natureSigns(this.town)) nearby.push({ id: sg.id, kind: "track", name: sg.text, x: sg.x, y: sg.y, offers: [{ op: "track", label: `Follow the ${sg.text}` }] });
    if (this.waterNear(2) && Object.keys(p.inventory).some((k) => k.startsWith("fishing rod"))) nearby.push({ id: "water", kind: "water", name: "the water", x: p.road.x, y: p.road.y, offers: [{ op: "fish", label: "Fish (half an hour)" }] });
    // Signs of what's about: tracks, smoke, a fresh grave (N26F decision 11).
    for (const sg of signsNear(this.town, 8)) nearby.push({ id: sg.id, kind: sg.kind, name: sg.name, x: sg.x, y: sg.y, offers: [] });
    // A ripe plot under or beside the player: they can hire on for the day's reaping (N26G).
    const field = this.town.store ? (plotUnder(realm, this.town.store, p.road.x, p.road.y, today) ?? this.besidePlot()) : null;
    if (field && this.town.store && (plotTiles(realm, this.town.store, field.s, field.plot, today) as Uint8Array).includes(5)) nearby.push({ id: `plot:${field.plot.id}`, kind: "field", name: `a ripe field of ${field.s.name}'s`, x: field.plot.x, y: field.plot.y, offers: [{ op: "reap", label: "Help with the reaping (a day's wage)" }] });
    // A cart left where a party was robbed (only where it really happened).
    for (const w of wrecksNear(this.town)) nearby.push({ id: w.id, kind: "cart", name: w.name, x: w.x, y: w.y, offers: [{ op: "search", label: "Search the cart" }] });
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
      pending: this.tollView() ?? viewOf(realm, land.data, this.town),
      nearby,
      stepsPerMinute: STEPS_PER_GAME_MINUTE,
      lightLeft: minuteOfDay >= DAY_STARTS * 60 && minuteOfDay < DAY_ENDS * 60 ? DAY_ENDS * 60 - minuteOfDay : null,
      ...this.closedNear(),
      ...(p.map?.lost ? { lost: true } : {}),
      quiet: this.quiet(),
    };
  }

  /**
   * Quick walking (N26 Part C2): `config.quietFactor` while nothing is in view (no party, commuter or hostile within sight,
   * no threat's ground or roadside place or gate near, nothing waiting for a choice), else 1. Only real time changes: a step
   * passes the same game time either way.
   */
  quiet(): number {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road || road.pending || config.quietFactor <= 1) return 1;
    const land = landOf(realm);
    const SIGHT = 60;
    if (journeysNear(realm, land.data, road, SIGHT, this.minute()).length > 0) return 1;
    if (Object.values(this.town.roadCreatures).some((c) => !c.outcome)) return 1;
    if (territoriesAt(realm, land.data, road).length > 0) return 1;
    if (placesNear(land, road, 30).length > 0) return 1;
    if (land.data.footprints.some((f) => road.x >= f.x0 - SIGHT && road.x <= f.x1 + SIGHT && road.y >= f.y0 - SIGHT && road.y <= f.y1 + SIGHT)) return 1;
    if (commutersNear(this.town, SIGHT).length > 0) return 1;
    return config.quietFactor;
  }

  /** Snowed-in high roads within a few days' walk, in words (N30). */
  private closedNear(): { closed?: string[] } {
    const realm = this.world.realm;
    const road = this.world.player.road;
    if (!realm || !road) return {};
    const data = landOf(realm).data;
    const shut = closedOn(realm, data, this.world.day);
    if (shut.size === 0) return {};
    const out = data.roads.filter((r) => shut.has(r.id) && r.pass && Math.hypot(r.pass.x - road.x, r.pass.y - road.y) < 12000).map((r) => `${highRoadWords(realm, r)} is snowed in`);
    return out.length > 0 ? { closed: out } : {};
  }
}

export { advanceMinutes, absoluteHour, itemKey };
