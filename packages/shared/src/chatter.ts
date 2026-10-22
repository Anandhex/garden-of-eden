/**
 * What kind of exchange two people had (N37). Code decides it (server: game/chatter/), from who they are and how they get on; the
 * words in the bubbles are the last step (crowd.ts `chatLines` takes the kind). Shared so the browser draws the bubble that matches
 * what really happened.
 */
export const INTERACTIONS = ["greet", "bow", "refuse_bow", "sneer", "insult", "humiliate", "order", "refuse_order", "complain", "share_news", "flatter", "threaten", "apologise"] as const;
export type InteractionKind = (typeof INTERACTIONS)[number];

/** Exchanges that leave one of them wronged: they are events, may leave a grievance, and are drawn with a red edge. */
export const HOSTILE: ReadonlySet<InteractionKind> = new Set<InteractionKind>(["refuse_bow", "sneer", "insult", "humiliate", "refuse_order", "threaten"]);

export const isInteraction = (s: string): s is InteractionKind => (INTERACTIONS as readonly string[]).includes(s);

/**
 * One exchange on the player's map that was not a plain greeting, sent with the snapshot so the bubble can match it (the pair is a
 * pair of `chats()`: roster indices, and `k` the chat's minute bucket, `floor((day × 1440 + minute) / CHAT_MINUTES)`).
 */
export interface ChatterMark {
  a: number;
  b: number;
  k: number;
  /** The roster index of whoever did it (`a` or `b`): who insulted, who refused. */
  actor: number;
  kind: InteractionKind;
  /** A line the model wrote for it (N37 step 6), or absent for the table's. */
  line?: string;
}
