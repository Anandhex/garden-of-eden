export const config = {
  ollamaHost: process.env.OLLAMA_HOST ?? "http://localhost:11434",
  // Tested on an 8 GB M2: fast (~1-3 s) and the most reliable small model at tool calls.
  model: process.env.NPC_MODEL ?? "qwen3:4b-instruct",
  // Ollama's default context is small; anything beyond it is silently dropped.
  numCtx: 4096,
  temperature: 0.7,
  // Keeps NPC replies short.
  maxReplyTokens: 150,
  // Keep the model loaded between turns so replies start fast.
  keepAlive: "30m",
  // Where permanent game records (like deaths) are saved.
  deathsFile: process.env.DEATHS_FILE ?? "saves/deaths.json",
  saveFile: process.env.SAVE_FILE ?? "saves/world.json",
  // /persuade and /intimidate: failures allowed per kind per in-game day, and how much each raises the next target.
  maxSocialFailuresPerDay: 3,
  socialFailurePenalty: 2,
  // What happens when the player drops to 0 HP: "knockout" (wake up later, robbed) or "permadeath" (the save is over).
  playerDefeat: (process.env.PLAYER_DEFEAT === "permadeath" ? "permadeath" : "knockout") as "knockout" | "permadeath",
  knockoutRecoveryHours: 8,
  /** Share of max HP the player wakes with after a knockout. */
  knockoutHpShare: 0.25,
  /** Share of the player's money the winner takes. */
  knockoutMoneyShare: 0.25,
  // How many in-game days make a year. NPCs and creatures age (and can die of old age) on this calendar.
  daysPerYear: Math.max(1, Number(process.env.DAYS_PER_YEAR ?? 12)),
  // In a fight, real seconds the player has to act. If they don't, their turn is lost and the opponent strikes. 0 turns it off.
  combatTickSeconds: Math.max(0, Number(process.env.COMBAT_TICK_SECONDS ?? 6)),
  // N16: while the player stands about (no talk, no fight), a game minute passes every this many real seconds, so the townsfolk keep moving. 0 turns it off (TIME_FLOW_SECONDS=0).
  timeFlowSeconds: Math.max(0, Number(process.env.TIME_FLOW_SECONDS ?? 2)),
  // In-game minutes each kind of turn takes. /wait and training still move whole hours.
  turnMinutes: { talk: 2, trade: 5, fight: 1 },
  // Safety valve: max model round-trips (speech + tool calls) per player line.
  maxStepsPerTurn: 4,
  // Prompt tokens to stay under (system prompt + tools + history). Leaves room in numCtx for the reply.
  contextTokenBudget: 3000,
  llmRetries: 1,
  // Content limits (design rule 7), enforced in code before any feature that touches them.
  content: {
    // Romance is opt-in for the player (ROMANCE=on) and per NPC (romance.open), and never with a minor.
    romance: process.env.ROMANCE === "on",
    // Whether NPCs marked `minor` can be attacked at all.
    minorsCanBeAttacked: false,
    // NPCs court, marry and have children among themselves (game/family.ts). Never a minor; the player only with ROMANCE=on.
    npcMarriage: process.env.NPC_MARRIAGE !== "off",
  },
  // Families (N11.3, game/family.ts). Ages and days follow config.daysPerYear.
  family: {
    // Nights of growing closer before a courting pair marries.
    courtshipNights: 6,
    // Most years between two NPCs who court.
    maxAgeGap: 15,
    // Courting starts this many years after their species is grown (18 for humans): nobody courts the day they come of age.
    courtingAfterAdult: 2,
    // Chance, each night, that a married couple with room for a child starts expecting one.
    conceptionChance: 0.15,
    // Days from expecting to birth (9 days is three quarters of a 12-day year).
    pregnancyDays: Math.max(1, Number(process.env.PREGNANCY_DAYS ?? 9)),
    // Days after a birth before the next child can be expected.
    restDays: 12,
    maxChildrenPerCouple: 3,
    // No births once this many NPCs are alive in the town (8 GB: every NPC is a prompt).
    maxPopulation: 14,
    // Age a child starts talking and running errands (younger ones stay at home).
    talkAge: 5,
  },
  // Embedding model for recall by meaning (game/db.ts). Optional: without it a hashed bag-of-words stands in.
  embedModel: process.env.EMBED_MODEL ?? "nomic-embed-text",
  // Long-term store (SQLite): the full event log, conversation summaries, director log, embeddings.
  dbFile: process.env.DB_FILE ?? "saves/world.db",
  // The world director (N12): a nightly chronicle, director quests and character drift. "off" to skip the model calls.
  director: process.env.DIRECTOR !== "off",
  // Most director proposals accepted per night.
  directorMaxPerNight: 3,
  // The wider realm (N13): kingdoms, towns and villages living on their own, a day at a time, in code. "off" to keep Millbrook alone.
  realm: process.env.REALM !== "off",
  // Seed for a new world's realm (the same seed gives the same realm). Unset: rolled from the new world's dice.
  realmSeed: process.env.REALM_SEED ? Number(process.env.REALM_SEED) : undefined,
  // The admin view (N17, /admin) shows the truth and moves the clock, so it answers only to this machine. ADMIN=on lifts that check.
  admin: process.env.ADMIN === "on",
  // Off-screen planning (one short call per NPC per day) and conversation summaries.
  planning: process.env.PLANNING !== "off",
  summaries: process.env.SUMMARIES !== "off",
  // G2 timeout budget: with no first word from the model after this many ms, the NPC says a filler line ("Hmm.") and the game keeps waiting.
  fillerAfterMs: Math.max(0, Number(process.env.FILLER_AFTER_MS ?? 3000)),
  // G1 request queue: actions wait their turn (one model call at a time on 8 GB); past this many waiting, new ones are turned away.
  maxQueuedRequests: 8,
  // T14 NPC voices. With PIPER_URL (a running `python -m piper.http_server`'s endpoint, e.g. http://127.0.0.1:5000/synthesize) or PIPER_BIN (the piper program), the server
  // speaks with Piper; otherwise the browser's own speech is used. PIPER_VOICES is where the .onnx voice models live.
  voice: {
    piperUrl: process.env.PIPER_URL ?? "",
    piperBin: process.env.PIPER_BIN ?? "",
    piperVoices: process.env.PIPER_VOICES ?? "voices",
    // Spoken sentences kept in memory, so a repeated line (greetings, fillers) costs nothing.
    cacheEntries: 200,
    timeoutMs: 15_000,
  },
  // The player's name when they haven't chosen one. NPCs who don't know it hear this instead of a real name.
  defaultPlayerName: "Traveler",
};
