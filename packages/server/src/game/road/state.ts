/**
 * What the player keeps about being on the road (N26). `player.site` stays the settlement they set out from
 * (the world's "today" is that place's own state), so everything that needs a site keeps working; `player.road`
 * says they are walking between places, and where.
 */
export interface RoadState {
  /** The tile they stand on: global tile coordinates. */
  x: number;
  y: number;
  /** Road steps since the last whole game minute (seven make one). */
  steps: number;
  /** The settlement they set out from, and the one they are bound for (set from the Realm tab). */
  from: string;
  dest?: string;
  /** Tolls paid, by place id → the day. */
  paid: Record<string, number>;
  /** Threats already faced (a pack's ground, a gang's ambush) → the day, so one is met once a day. */
  met: Record<string, number>;
  /** Situations handled or ignored (id of the situation on that segment that day) → the day. */
  seen: Record<string, number>;
  /** The road they are on and the stretch of it walked without a break, for recording walked segments. */
  track?: { road: string; lo: number; hi: number };
  /** Something waiting for a choice: a situation, a traveller who stopped them. */
  pending?: { kind: "situation"; id: string; key: string };
  /** Where they last slept in the open (a camp), to sleep better there. */
  camp?: { x: number; y: number; day: number };
}

/** What the player needs on the road (D1): 0 is none, 100 is full. In a place they are topped up by meals and a bed. */
export interface RoadNeeds {
  food: number;
  water: number;
  rest: number;
  /** The absolute game minute these were last brought up to date. */
  at: number;
}

export const MOUNTS = ["horse", "cart"] as const;
export type MountKind = (typeof MOUNTS)[number];

/** A horse or a cart the player owns (D2). */
export interface Mount {
  kind: MountKind;
  name: string;
  /** 0..100: a tired horse is slower; a lame one cannot be ridden. */
  fitness: number;
  /** 0..100: how fed it is; it falls on the road. */
  fed: number;
  lame?: boolean;
  /** Where it is stabled (a settlement id) when the player is not riding, or null when with the player. */
  stabled?: string | null;
}

/** Fresh needs. */
export const freshNeeds = (at: number): RoadNeeds => ({ food: 90, water: 90, rest: 90, at });
