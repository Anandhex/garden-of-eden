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
  },
  // The player's name when they haven't chosen one. NPCs who don't know it hear this instead of a real name.
  defaultPlayerName: "Traveler",
};
