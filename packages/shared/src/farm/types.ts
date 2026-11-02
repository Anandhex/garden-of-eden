/**
 * Fields outside the village (N26G). A settlement's farmland lies around it in the road world, cut into plots; each plot
 * is held by a household, the lord's demesne, the temple's glebe or the commons, and each tile of it can carry its own
 * mark (trampled, grazed, rooted, burned...). What's stored is what happened (sowings and field events); how a plot looks
 * on a day is a pure function of that (`growthAt`), the same on the server and in the browser.
 */
export type PlotKind = "strip" | "close" | "paddock" | "meadow" | "orchard";

export interface Plot {
  /** `pl:<site>:<n>`. */
  id: string;
  site: string;
  /** Global tiles: the top-left corner, width and height. */
  x: number;
  y: number;
  w: number;
  h: number;
  kind: PlotKind;
  /** Which of the three fields of the rotation it is in (0..2); paddocks and meadows aren't rotated. */
  field: number;
  /** How far out it lies (0: the infield by the wall). */
  ring: number;
}

export const FIELD_EVENTS = ["sow", "weed", "harvest", "graze", "root", "seed-eaten", "stock", "trample", "storm", "hail", "flood", "frost", "blight", "fire", "theft"] as const;
export type FieldEventKind = (typeof FIELD_EVENTS)[number];

export interface FieldEvent {
  plot: string;
  day: number;
  kind: FieldEventKind;
  /** Indexes of the plot's tiles it touched (row by row); empty means the whole plot. */
  tiles: number[];
  /** Who or what: a person row, a beast row, "deer", "crows", "weather", "player". */
  by: string;
  /** How much (yield reaped, share lost). */
  amount: number;
}

export interface Sowing {
  plot: string;
  crop: string;
  day: number;
}

export interface CropDef {
  id: string;
  name: string;
  /** Days of the year (1..daysPerYear) it may be sown in. */
  sow: [number, number];
  /** Days from sowing to ripe. */
  grow: number;
  /** Days it stands ripe before it starts to rot. */
  ripe: number;
  /** Food (person-days) a healthy tile gives. */
  yield: number;
  /** Country it does well in (better yield) and badly in. */
  likes: string[];
  dislikes: string[];
  /** What eats it in the field. */
  eatenBy: string[];
  /** Spoilt by a frost while it's young; by standing water. */
  frost: boolean;
  flood: boolean;
  /** Grown on: "field" (strips and closes), "meadow" (hay), "orchard". */
  on: "field" | "meadow" | "orchard";
}

/** Stage of a tile. 0..7 is growth; 10 and up is a mark of what happened to it. */
export const STAGE = { bare: 0, sown: 1, shoots: 2, grown: 3, tall: 4, ripe: 5, stubble: 6, rotting: 7 } as const;
export const MARK: Partial<Record<FieldEventKind, number>> = { trample: 10, graze: 11, root: 12, fire: 13, flood: 14, theft: 15, storm: 16, hail: 16, frost: 17, blight: 18, stock: 11, "seed-eaten": 19 };
/** A tile with a mark yields nothing this season. */
export const isMarked = (stage: number): boolean => stage >= 10;
