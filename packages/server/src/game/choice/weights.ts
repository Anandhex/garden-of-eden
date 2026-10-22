/**
 * Every weight of the action menu, in one table (N38), so a balance pass changes numbers here and nowhere else. A score is a sum of
 * named parts `weight × feature`; the feature is a 0..1 reading of the person's state, so the weights compare across actions.
 */
export const W = {
  /** What the schedule's own pick is worth to the action that does it: the day goes on as usual unless something beats this. */
  habit: 0.85,
  /** Hunger (0..1) is worth this to eating, and sours a temper by the second. */
  hunger: 1.4,
  hungerSours: 0.25,
  /** Tiredness to rest. */
  fatigue: 0.9,
  /** Being broke makes work and selling worth more. */
  broke: 0.35,
  /** Ambition (0..1) adds to working at all. */
  ambition: 0.12,
  /** Sociability to socialising; each person in the gathering adds a little, to a limit. */
  social: 0.4,
  crowd: 0.04,
  crowdMax: 8,
  festival: 0.3,
  /** A grudge (hate 0..1.5) pushes toward the confrontation. */
  grudge: 1.0,
  /** (bravery − 0.5) and (temper − 0.5) shift confronting; low-bravery fear of standing is felt in proportion to the gap. */
  bold: 1.2,
  hot: 0.5,
  /** Per rank the other stands above them, scaled by how cautious they are. */
  rankFear: 0.2,
  /** Fear of the other, to everything hostile (0..100 scaled). */
  fearOfThem: 0.5,
  /** An insult is cheaper than a confrontation and needs less courage. */
  insultGrudge: 0.8,
  /** Carrying out a revenge goal: its strength to the score. */
  revenge: 1.5,
  /** Greed and want to stealing; honesty against. */
  greed: 0.7,
  honest: 0.9,
  /** Opportunity: the other is alone, or the street is empty. */
  opportunity: 0.2,
  /** Affection to court, suitability the gate. */
  affection: 0.6,
  spark: 0.2,
  /** A rumour: dishonesty and hate. */
  dishonest: 0.5,
  rumourHate: 0.9,
  /** Recruit: the recruiter's loyalty; their discontent. */
  recruit: 0.5,
  /** Travelling: the wish to leave. */
  leave: 0.9,
  /** Mood effects: anger (mood ≤ 0 → value) pushes hostile actions. */
  anger: 0.12,
  /** Violence: temper plus hate plus bravery, minus fear. */
  violence: 1.0,
  /** Buying: coin to spend, a gathering with a seller. */
  coin: 0.3,
  /** A repeat of the same non-habit action is damped by this per time in a row. */
  loop: 0.35,
} as const;

/** Cooldowns between picks, in hours (hour grain). A townsperson's day grain uses `DAY_COOLDOWNS`. */
export const HOUR_COOLDOWNS: Record<string, number> = {
  confront: 24,
  insult: 4,
  attack: 24 * 7,
  steal: 12,
  court: 24,
  spread_rumour: 12,
  revenge: 24,
  recruit: 24,
  travel: 24 * 3 * 4,
  gossip: 1,
};

/** In days (day grain). `travel` is once a season. */
export const DAY_COOLDOWNS: Record<string, number> = {
  confront: 2,
  insult: 1,
  attack: 7,
  steal: 3,
  court: 2,
  spread_rumour: 2,
  recruit: 4,
  travel: 3,
  gossip: 0,
};

/** Violent deeds a place may see in a day, and in the player's place per hour. */
export const MAX_FIGHTS_PER_PLACE_PER_DAY = 2;
export const MAX_FIGHTS_PER_HOUR = 1;
/** Picks of one non-habit action in a row after which a person stops (the loop guard). */
export const MAX_RUN = 3;

/** The softmax temperature from recklessness (0..1): a cautious person nearly always plays the top score, a reckless one often doesn't. */
export const TEMPERATURE = { base: 0.05, spread: 0.5 } as const;
