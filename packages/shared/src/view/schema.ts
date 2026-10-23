/**
 * The view protocol (G5): what the server (the brain) sends an engine adapter, and what the adapter sends back.
 * Defined once here in zod; TypeScript types come from `z.infer`, and `npm run schema` writes JSON Schema to
 * protocol/schema/ for Unity (C#) and Unreal (C++) adapters. The rule of the line: an adapter decides how to
 * show something, never what is true or allowed.
 */
import { z } from "zod";

/** Bumped when a message changes shape; the server refuses a client with another version. */
export const PROTOCOL_VERSION = 1;

const Point = z.object({ x: z.number(), y: z.number() });

// ---------- intents (adapter → server) ----------

export const IntentSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), version: z.number().int(), view: z.object({ w: z.number().int(), h: z.number().int() }), engine: z.string() }),
  z.object({ t: z.literal("view"), w: z.number().int().optional(), h: z.number().int().optional(), hidden: z.boolean().optional() }),
  z.object({ t: z.literal("step"), dx: z.union([z.literal(-1), z.literal(0), z.literal(1)]), dy: z.union([z.literal(-1), z.literal(0), z.literal(1)]) }),
  z.object({ t: z.literal("moveTo"), x: z.number().int(), y: z.number().int() }),
  z.object({ t: z.literal("click"), x: z.number().int(), y: z.number().int() }),
  z.object({ t: z.literal("interact") }),
  z.object({ t: z.literal("fight") }),
  z.object({ t: z.literal("flee") }),
  z.object({ t: z.literal("say"), mode: z.string(), text: z.string().max(500) }),
  z.object({ t: z.literal("act"), action: z.string(), args: z.record(z.string(), z.unknown()).optional() }),
  /** Open a dialog (train, wares, repair, give, favour, order, steal, ability, craft) or close it (null). */
  z.object({ t: z.literal("panel"), panel: z.string().nullable(), arg: z.string().optional() }),
  /** Pick something in a panel (the realm map's place). */
  z.object({ t: z.literal("select"), what: z.string(), id: z.string().nullable() }),
  z.object({ t: z.literal("close") }),
  z.object({ t: z.literal("answer"), prompt: z.string(), option: z.string() }),
  z.object({ t: z.literal("time"), flow: z.boolean() }),
  z.object({ t: z.literal("simulate"), speed: z.enum(["off", "slow", "normal", "fast", "days"]) }),
  z.object({ t: z.literal("cancel") }),
  z.object({ t: z.literal("newGame") }),
]);
export type Intent = z.infer<typeof IntentSchema>;

// ---------- the frame: what to draw ----------

export const ActorSchema = z.object({
  id: z.string(),
  kind: z.enum(["player", "npc", "folk", "traveller", "creature", "companion"]),
  x: z.number(),
  y: z.number(),
  facing: z.enum(["n", "e", "s", "w"]).optional(),
  /** `sprite` is an art id (art.ts); the adapter maps it to its own art. */
  look: z.object({ sprite: z.string(), tint: z.string().optional(), trim: z.string().optional(), size: z.number().optional() }),
  label: z.string().nullable(),
  /** What to show when the actor is far (e.g. "[caravan]"), or null to show nothing. */
  shortLabel: z.string().nullable().optional(),
  tip: z.string(),
  hp: z.number().optional(),
  flags: z.array(z.enum(["hostile", "dead", "unconscious", "engaged", "quest", "busy", "inside", "noble", "lowborn"])),
  /** The tiles to animate through (no pathfinding in the adapter). */
  route: z.array(Point).optional(),
});
export type Actor = z.infer<typeof ActorSchema>;

export const PatchSchema = z.object({
  key: z.string(),
  x0: z.number().int(),
  y0: z.number().int(),
  w: z.number().int(),
  h: z.number().int(),
  /** Indices into TERRAIN_IDS, row by row. */
  ground: z.array(z.number().int()),
  /** Indices into OBJECT_IDS (0 = nothing), row by row. */
  objects: z.array(z.number().int()),
});
export type Patch = z.infer<typeof PatchSchema>;

export const BuildingSchema = z.object({ id: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), kind: z.string(), color: z.string(), lit: z.boolean(), label: z.string(), tip: z.string() });
export const LightSchema = z.object({ id: z.string(), x: z.number(), y: z.number(), kind: z.enum(["window", "lamp", "fire", "torch", "forge", "magic"]), on: z.boolean() });
export const SignSchema = z.object({ id: z.string(), x: z.number(), y: z.number(), text: z.string(), kind: z.enum(["exit", "place"]) });
export const ChatterSchema = z.object({ a: z.string(), b: z.string(), lines: z.tuple([z.string(), z.string()]), hot: z.boolean(), bow: z.boolean() });

export const FrameSchema = z.object({
  map: z.object({ id: z.string(), name: z.string(), kind: z.enum(["place", "road"]), w: z.number().nullable(), h: z.number().nullable() }),
  box: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
  patches: z.array(PatchSchema).optional(),
  buildings: z.array(BuildingSchema).optional(),
  lights: z.array(LightSchema).optional(),
  signs: z.array(SignSchema).optional(),
  /**
   * `upsert`: actors new or changed in more than their place (whole). `move`: actors that only moved, as compact
   * `[id, x, y]` (a busy town moves hundreds a minute). `routes`: the tiles to walk through for some of the movers.
   */
  actors: z.object({
    upsert: z.array(ActorSchema),
    move: z.array(z.tuple([z.string(), z.number(), z.number()])).optional(),
    routes: z.array(z.object({ id: z.string(), route: z.array(Point) })).optional(),
    remove: z.array(z.string()),
  }),
  player: z.object({ id: z.literal("player"), x: z.number(), y: z.number() }),
  ambience: z.object({ light: z.number(), timeOfDay: z.string(), weather: z.string(), season: z.string() }),
  /** "E: talk", drawn under `target`. */
  prompt: z.object({ text: z.string(), target: z.string(), x: z.number(), y: z.number(), tone: z.enum(["talk", "fight", "danger"]) }).nullable(),
  fight: z.object({ secondsLeft: z.number(), tick: z.number() }).nullable(),
  chatter: z.array(ChatterSchema).optional(),
  gossip: z.array(z.object({ who: z.string(), text: z.string() })).optional(),
  stepMs: z.number(),
});
export type Frame = z.infer<typeof FrameSchema>;

// ---------- the UI model: what the panels hold ----------

export interface UiAction {
  id: string;
  label: string;
  enabled: boolean;
  why?: string;
  style?: "danger" | "yes" | "ghost";
  /** A text box whose value goes into `intent.args[arg]` (give coin: "5 silver"). */
  input?: { arg: string; placeholder: string };
  intent: Intent;
}
export const UiActionSchema: z.ZodType<UiAction> = z.object({
  id: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  why: z.string().optional(),
  style: z.enum(["danger", "yes", "ghost"]).optional(),
  input: z.object({ arg: z.string(), placeholder: z.string() }).optional(),
  intent: IntentSchema,
});

const Row = z.object({ text: z.string(), value: z.string().optional(), bar: z.number().optional(), actions: z.array(UiActionSchema).optional() });
const Section = z.object({ title: z.string(), rows: z.array(Row) });
export const FeedLineSchema = z.object({ id: z.number().int(), kind: z.string(), text: z.string() });

export const UiModelSchema = z.object({
  header: z.object({
    place: z.string(),
    placeTip: z.string(),
    clock: z.string(),
    today: z.string(),
    todayTip: z.string(),
    hp: z.string(),
    mp: z.string(),
    coin: z.string(),
    model: z.object({ ready: z.boolean(), text: z.string(), banner: z.string() }),
    busy: z.boolean(),
    actions: z.array(UiActionSchema),
    time: z.object({ flows: z.boolean(), shown: z.boolean() }),
    simulate: z.object({ speed: z.string(), note: z.string().nullable(), speeds: z.array(z.object({ id: z.string(), label: z.string() })) }),
  }),
  feed: z.object({ lines: z.array(FeedLineSchema) }),
  chat: z.union([
    z.object({ open: z.literal(false) }),
    z.object({
      open: z.literal(true),
      npc: z.string(),
      name: z.string(),
      role: z.string(),
      stats: z.array(z.string()),
      log: z.array(z.object({ kind: z.string(), text: z.string() })),
      offers: z.array(z.object({ text: z.string(), actions: z.array(UiActionSchema) })),
      quick: z.array(UiActionSchema),
      modes: z.array(z.object({ id: z.string(), label: z.string(), placeholder: z.string() })),
      tools: z.array(UiActionSchema),
    }),
  ]),
  sheet: z.object({ tabs: z.array(z.object({ id: z.string(), label: z.string(), sections: z.array(Section) })) }),
  roadbar: z.object({ shown: z.boolean(), items: z.array(z.object({ text: z.string(), dim: z.boolean().optional(), need: z.number().optional() })), actions: z.array(UiActionSchema) }),
  /** The realm (RealmView), drawn by the adapter as a map; null in worlds without one. */
  realm: z.record(z.string(), z.unknown()).nullable(),
  modal: z.object({ kind: z.string(), title: z.string(), body: z.string(), sections: z.array(Section), actions: z.array(UiActionSchema) }).nullable(),
  /** Who speaks, for the adapter's voice settings ("hear a sample"). */
  cast: z.array(z.object({ id: z.string(), name: z.string(), sample: z.string(), voice: z.record(z.string(), z.unknown()) })),
});
export type UiModel = z.infer<typeof UiModelSchema>;

// ---------- server messages ----------

export const SpeechSchema = z.object({
  t: z.literal("speech"),
  npc: z.string(),
  name: z.string().optional(),
  voice: z.record(z.string(), z.unknown()).nullable(),
  delta: z.string().optional(),
  filler: z.string().optional(),
  done: z.literal(true).optional(),
  thinking: z.literal(true).optional(),
});
export const PromptSchema = z.object({ t: z.literal("prompt"), id: z.string(), title: z.string(), body: z.string(), options: z.array(z.object({ id: z.string(), label: z.string() })) });

export const ServerMsgSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("hello"), version: z.number().int(), session: z.string() }),
  /** Whole on connect and on a new map (`whole: true`), changes after. */
  z.object({ t: z.literal("frame"), seq: z.number().int(), whole: z.boolean(), frame: FrameSchema }),
  /** A T13 game event (packages/shared/src/events.ts), unchanged. */
  z.object({ t: z.literal("event"), event: z.record(z.string(), z.unknown()) }),
  SpeechSchema,
  /** Changed panels only. */
  z.object({ t: z.literal("ui"), ui: UiModelSchema.partial() }),
  /** New feed lines to append (the whole feed is in `ui.feed`). */
  z.object({ t: z.literal("feed"), lines: z.array(FeedLineSchema) }),
  PromptSchema,
  z.object({ t: z.literal("replaced") }),
  z.object({ t: z.literal("error"), text: z.string() }),
]);
export type ServerMsg = z.infer<typeof ServerMsgSchema>;
export type SpeechMsg = z.infer<typeof SpeechSchema>;
export type PromptMsg = z.infer<typeof PromptSchema>;
