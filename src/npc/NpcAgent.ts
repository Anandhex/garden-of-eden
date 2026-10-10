import { config } from "../config.js";
import { payDebts } from "../game/debts.js";
import { defaultRng, type Rng } from "../game/dice.js";
import { type UseResult, useHealingItem } from "../game/healing.js";
import { resolveItem } from "../game/items.js";
import { acceptQuest, isQuestTalk, refreshNeedQuests, type TurnInResult, turnInQuests } from "../game/quests.js";
import { busyWith, passMinutes, passTime } from "../game/simulation.js";
import { isTrainingTalk, type TrainingResult, train } from "../game/training.js";
import type { ChatMessage, ChatResult, LLMProvider, ToolDef } from "../llm/provider.js";
import { estimateMessage, estimateRequest } from "../llm/tokens.js";
import type { Skill } from "./skills.js";
import {
  type ActionContext,
  type ActionResult,
  acceptOffer,
  acceptPurchase,
  applyAction,
  declineOffer,
  declinePurchase,
  isTradeTalk,
  haggle,
  parseAction,
  playerAttack,
  npcFightTurn,
  isPleading,
  playerFlee,
  type SocialKind,
  socialCheck,
  toolsFor,
} from "./actions.js";
import { LeadingMoodFilter } from "./moodPrefix.js";
import { buildEventMessage, buildSystemPrompt, buildTurnMessage } from "./persona.js";
import { createNpcState } from "./state.js";
import { replyTokenFactor, traitsOf } from "./traits.js";
import type {
  AppliedAction,
  DefeatResult,
  NpcPersona,
  NpcState,
  TurnResult,
  WorldSnapshot,
} from "./types.js";

/** Tools that make an offer whose terms the game sets or checks. */
const OFFER_TOOLS = new Set(["offer_item", "offer_to_buy", "offer_training", "offer_job"]);

/** What a turn costs in game time (config.turnMinutes). */
type TurnKind = keyof typeof config.turnMinutes;

export class NpcAgent {
  readonly state: NpcState;
  private readonly system: string;
  /** The conversation so far (without the system prompt). */
  private history: ChatMessage[] = [];
  /** Whether the current player line is about trading (gates offer_to_buy). */
  private tradeTalk = false;
  /** Whether the current player line is about training (gates offer_training). */
  private trainingTalk = false;
  /** Whether the current player line is about work (gates offer_job). */
  private questTalk = false;
  /** Whether the current player line sounds like begging (gates end_fight). */
  private pleading = false;
  /** The player's last line, so a follow-up persuasion knows what it's about. */
  private lastPlayerLine = "";
  /**
   * The model's own count of the last request (Ollama's prompt_eval_count), and how many
   * history messages it covered. Used with the estimate to keep requests under budget.
   */
  private measured: { tokens: number; messages: number } | null = null;
  /** Reply length cap: sociable NPCs may say more (replyTokenFactor). */
  private readonly maxTokens: number;

  constructor(
    readonly persona: NpcPersona,
    private readonly llm: LLMProvider,
    /** Dice for checks and attacks. Pass a fixed one in tests. */
    private readonly rng: Rng = defaultRng,
    initialState?: NpcState,
  ) {
    this.state = initialState ?? createNpcState(persona);
    this.system = buildSystemPrompt(persona);
    this.maxTokens = Math.round(config.maxReplyTokens * replyTokenFactor(traitsOf(persona)));
  }

  /** The conversation the model sees (without the system prompt). For tests and debugging. */
  get messages(): readonly ChatMessage[] {
    return this.history;
  }

  /**
   * Time a turn takes: talking ~2 minutes, a trade ~5, a fight round ~1. The NPC is
   * with the player, so they heal and finish jobs but don't start new work.
   */
  private spend(world: WorldSnapshot, kind: TurnKind): void {
    passMinutes(this.persona, this.state, world, config.turnMinutes[kind], this.rng, { talking: true });
  }

  /** Dead NPCs never speak or act again. */
  get isDead(): boolean {
    return this.state.outcome === "dead";
  }

  /** What the NPC is busy making, or null if they're free to talk. The game shouldn't let the player interact while busy. */
  busyWith(world: WorldSnapshot): string | null {
    return busyWith(this.state, world);
  }

  /** Run one player turn: the NPC replies and may act. */
  async respond(playerLine: string, world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    if (this.isDead) return { text: "", actions: [] };
    const busy = this.busyWith(world);
    if (busy) return { text: "", actions: [], busy };
    // Training and quest requests stay open for one more turn, so "Yes, haggling"
    // after "Could you teach me something?" can still get an offer.
    const topic = {
      trading: isTradeTalk(playerLine),
      training: isTrainingTalk(playerLine) || isTrainingTalk(this.lastPlayerLine),
      questing: isQuestTalk(playerLine) || isQuestTalk(this.lastPlayerLine),
    };
    // Needs change as stock runs low, so work out the NPC's current quests first.
    if (topic.questing) refreshNeedQuests(this.persona, this.state, world.player);
    this.lastPlayerLine = playerLine;
    this.pleading = isPleading(playerLine);
    const fighting = this.state.inCombat;
    const turn = await this.withTopic(topic, () =>
      this.runTurn(buildTurnMessage(this.persona, this.state, world, playerLine, topic), world, onText),
    );
    this.pleading = false;
    const result = this.continueFight(turn, world);
    this.spend(world, fighting || this.state.inCombat ? "fight" : "talk");
    return result;
  }

  /**
   * In a fight the NPC strikes every turn, whatever the player does, until someone
   * dies, flees, or the NPC ends it (end_fight). Skipped if it already attacked
   * this turn (e.g. its first strike via attack_player). The roll happens in code.
   */
  private continueFight(turn: TurnResult, world: WorldSnapshot): TurnResult {
    const s = this.state;
    // The NPC's first strike (attack_player) may already have dropped the player.
    const early = this.resolvePlayerDefeat(world);
    if (early) return { ...turn, defeat: early };
    if (!s.inCombat || s.outcome || world.player.hp <= 0) return turn;
    if (turn.actions.some((a) => a.name === "attack_player" && a.ok)) return turn;
    // Hurt NPCs with a healing item use it instead of striking (npcFightTurn).
    const { name, ...result } = npcFightTurn(this.context(world));
    const actions = [...turn.actions, { name, args: { automatic: true }, ...result }];
    const defeat = this.resolvePlayerDefeat(world);
    return { ...turn, actions, ...(defeat ? { defeat } : {}) };
  }

  /**
   * The player has dropped to 0 HP: apply config.playerDefeat. Returns what happened,
   * or null if the player is still standing.
   * - "knockout": the NPC takes a share of their gold, time passes while they're out
   *   (the NPC heals and gets on with their day), and they wake with a quarter of their HP.
   * - "permadeath": the player is dead and the save is over.
   * Either way the NPC remembers it, and the encounter ends.
   */
  private resolvePlayerDefeat(world: WorldSnapshot): DefeatResult | null {
    const s = this.state;
    const player = world.player;
    if (player.hp > 0 || s.outcome) return null;
    s.inCombat = false;
    s.lastCombatNote = null;
    s.conversationOver = true;
    const remember = (id: string, text: string) => {
      if (!s.memories.some((m) => m.id === id)) s.memories.push({ id, day: world.day, text });
    };

    if (config.playerDefeat === "permadeath") {
      s.outcome = "killed player";
      player.death = { day: world.day, hour: world.hour, killedBy: this.persona.name };
      remember("killed-player", `You killed ${player.name} in a fight on day ${world.day}.`);
      return { rule: "permadeath", goldTaken: 0, hoursOut: 0, log: [], message: `${this.persona.name} killed ${player.name}.` };
    }

    s.outcome = "knocked out";
    const goldTaken = Math.floor(player.gold * config.knockoutGoldShare);
    player.gold -= goldTaken;
    s.gold += goldTaken;
    payDebts(this.persona, s);
    remember(
      `beat-player-day-${world.day}`,
      `You beat ${player.name} in a fight on day ${world.day}${goldTaken > 0 ? ` and took ${goldTaken} gold off them` : ""}.`,
    );
    const hoursOut = config.knockoutRecoveryHours;
    const log = passTime(this.persona, s, world, hoursOut, this.rng);
    player.hp = Math.max(1, Math.ceil(player.maxHp * config.knockoutHpShare));
    return {
      rule: "knockout",
      goldTaken,
      hoursOut,
      log,
      message:
        `${this.persona.name} knocked you out. You wake ${hoursOut} hours later with ${player.hp}/${player.maxHp} HP` +
        (goldTaken > 0 ? `, ${goldTaken} gold lighter.` : "."),
    };
  }

  /**
   * The player tries to run from the fight. Escaping ends the conversation (the
   * NPC shouts after them); failing gives the NPC a free hit, and it reacts.
   */
  async playerFlees(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    onRoll: (result: ActionResult & { escaped: boolean }) => void = () => {},
  ): Promise<TurnResult & { flee: ActionResult & { escaped: boolean } }> {
    const flee = playerFlee(this.context(world));
    onRoll(flee);
    if (!flee.ok) return { text: "", actions: [], flee };
    // A failed escape gives the NPC a free hit, which may knock the player out ("Traveler collapses.") before the NPC speaks.
    const defeat = this.resolvePlayerDefeat(world);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, flee.message), world, onText);
    this.spend(world, "fight");
    return { ...turn, flee, ...(defeat ? { defeat } : {}) };
  }

  /**
   * The player uses a healing item from their own inventory (`/use`). Done in code,
   * with no model call. In a fight it costs the player their turn: the NPC acts.
   */
  useItem(world: WorldSnapshot, item: string): TurnResult & { use: UseResult } {
    const player = world.player;
    const key = resolveItem(player.inventory, item) ?? item;
    const use = useHealingItem(player.inventory, player, player.maxHp, key);
    if (!use.ok) return { text: "", actions: [], use };
    const fighting = this.state.inCombat;
    const turn = fighting ? this.continueFight({ text: "", actions: [] }, world) : { text: "", actions: [] };
    this.spend(world, fighting ? "fight" : "talk");
    return { ...turn, use };
  }

  /** Set the trade/training/quest flags for the whole turn (every round), then clear them. */
  private async withTopic<T>(
    topic: string | { trading: boolean; training: boolean; questing?: boolean },
    run: () => Promise<T>,
  ): Promise<T> {
    this.tradeTalk = typeof topic === "string" ? isTradeTalk(topic) : topic.trading;
    this.trainingTalk = typeof topic === "string" ? isTrainingTalk(topic) : topic.training;
    this.questTalk = typeof topic === "string" ? isQuestTalk(topic) : (topic.questing ?? false);
    try {
      return await run();
    } finally {
      this.tradeTalk = false;
      this.trainingTalk = false;
      this.questTalk = false;
    }
  }

  /** The player accepted the NPC's quest offer: it goes in their quest log, and the NPC reacts. */
  async acceptQuest(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { quest: string | null }> {
    const quest = acceptQuest(this.persona, this.state, world.player);
    const event = quest
      ? `${world.player.name} accepted your job "${quest.title}": bring ${quest.objective.qty} ${quest.objective.item}.`
      : `${world.player.name} wanted to accept, but that job is no longer available.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return { ...turn, quest: quest?.title ?? null };
  }

  /** The player turned down the NPC's quest offer. */
  async declineQuest(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    this.state.pendingQuest = null;
    const event = `${world.player.name} turned down your job.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /** The player hands in finished quests. Rewards are paid in code; the NPC reacts if anything was handed in. */
  async turnIn(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { turnIn: TurnInResult }> {
    const result = turnInQuests(this.persona, this.state, world);
    if (result.completed.length === 0) return { text: "", actions: [], turnIn: result };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message), world, onText);
    this.spend(world, "trade");
    return { ...turn, turnIn: result };
  }

  /** Let time pass: the NPC may craft (becoming busy) or sell stock. Returns what they did. */
  wait(world: WorldSnapshot, hours: number): string[] {
    return passTime(this.persona, this.state, world, hours, this.rng);
  }

  /**
   * The player accepted the pending offer: complete the sale in code, then let
   * the NPC react. `sale` says whether the sale went through.
   */
  async acceptOffer(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
  ): Promise<TurnResult & { sale: { ok: boolean; message: string } }> {
    const sale = acceptOffer(this.context(world));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, sale.message, true), world, onText);
    this.spend(world, "trade");
    return { ...turn, sale };
  }

  /** The player declined the pending offer: clear it, then let the NPC react. */
  async declineOffer(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    const result = declineOffer(this.context(world));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message, true), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /**
   * The player tries to persuade or intimidate. The roll happens in code; the
   * NPC is told the result and reacts. `check` has the roll and whether it worked.
   */
  async attempt(
    kind: SocialKind,
    playerLine: string,
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    /** Called with the roll before the NPC starts talking, so a UI can show it first. */
    onRoll: (result: ActionResult & { success: boolean }) => void = () => {},
  ): Promise<TurnResult & { check: ActionResult & { success: boolean } }> {
    const result = socialCheck(kind, playerLine, this.context(world));
    onRoll(result);
    if (!result.ok) return { text: "", actions: [], check: result };
    // "Please, I'll do anything" right after "Can you train me?" is about training.
    const topic = `${this.lastPlayerLine} ${playerLine}`;
    const turn = await this.withTopic(topic, () =>
      this.runTurn(
        buildEventMessage(this.persona, this.state, world, result.message, isTradeTalk(topic), isTrainingTalk(topic)),
        world,
        onText,
      ),
    );
    this.spend(world, "talk");
    return { ...turn, check: result };
  }

  /**
   * The player haggles over price. The roll happens in code; on success any
   * pending offer gets cheaper right away. The NPC is told and reacts.
   */
  async haggle(
    playerLine: string,
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    onRoll: (result: ActionResult & { success: boolean }) => void = () => {},
  ): Promise<TurnResult & { check: ActionResult & { success: boolean } }> {
    const result = haggle(playerLine, this.context(world));
    onRoll(result);
    if (!result.ok) return { text: "", actions: [], check: result };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message, true), world, onText);
    this.spend(world, "talk");
    return { ...turn, check: result };
  }

  /**
   * The player trains a skill under the NPC. Progress and the clock are handled
   * in code; the NPC is told how the session went and reacts as a teacher.
   */
  async train(
    skill: Skill,
    hours: number,
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    onResult: (result: TrainingResult) => void = () => {},
  ): Promise<TurnResult & { training: TrainingResult }> {
    const result = train(this.persona, this.state, world, skill, hours);
    onResult(result);
    if (!result.ok) return { text: "", actions: [], training: result };
    const event = `${result.message} Say a line as their teacher.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    return { ...turn, training: result };
  }

  /**
   * The player attacks the NPC. The roll happens in code; if the NPC is still
   * standing, it reacts (and may fight back or flee).
   */
  async attackedByPlayer(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    /** Called with the roll before the NPC starts talking, so a UI can show it first. */
    onRoll: (result: ActionResult & { damage: number }) => void = () => {},
  ): Promise<TurnResult & { hit: ActionResult & { damage: number } }> {
    if (this.isDead) {
      const none = { ok: false, damage: 0, message: `${this.persona.name} is already dead.` };
      onRoll(none);
      return { text: "", actions: [], hit: none };
    }
    const hit = playerAttack(this.context(world));
    onRoll(hit);
    if (this.isDead) return { text: "", actions: [], hit };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, hit.message), world, onText);
    // The NPC strikes back automatically (unless it fled, begged or ended the fight).
    const result = { ...this.continueFight(turn, world), hit };
    this.spend(world, "fight");
    return result;
  }

  /** The player accepted the NPC's offer to buy their item: complete it in code, then let the NPC react. */
  async acceptPurchase(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
  ): Promise<TurnResult & { sale: ActionResult }> {
    const sale = acceptPurchase(this.context(world));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, sale.message, true), world, onText);
    this.spend(world, "trade");
    return { ...turn, sale };
  }

  /** The player turned down the NPC's offer to buy: clear it, then let the NPC react. */
  async declinePurchase(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    const result = declinePurchase(this.context(world));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message, true), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /** The player accepted the NPC's training offer: run the session (paid in code), then the NPC reacts as a teacher. */
  async acceptTraining(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    onResult: (result: TrainingResult) => void = () => {},
  ): Promise<TurnResult & { training: TrainingResult }> {
    const offer = this.state.pendingTraining;
    this.state.pendingTraining = null;
    if (!offer) {
      const none: TrainingResult = { ok: false, message: "There is no training offer.", hoursSpent: 0, cost: 0, levelsGained: 0 };
      onResult(none);
      return { text: "", actions: [], training: none };
    }
    return this.train(offer.skill, offer.hours, world, onText, onResult);
  }

  /** The player turned down the NPC's training offer. */
  async declineTraining(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    const offer = this.state.pendingTraining;
    this.state.pendingTraining = null;
    const event = offer
      ? `${world.player.name} turned down your offer to teach ${offer.skill.replace("_", "-")} for ${offer.cost} gold.`
      : `${world.player.name} doesn't want training right now.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  private context(world: WorldSnapshot): ActionContext {
    return {
      persona: this.persona,
      state: this.state,
      world,
      rng: this.rng,
      tradeTalk: this.tradeTalk,
      trainingTalk: this.trainingTalk,
      questTalk: this.questTalk,
      pleading: this.pleading,
    };
  }

  /**
   * Send one message (player line or game event), apply any actions the NPC
   * takes, and loop until it has said something.
   */
  private async runTurn(
    userContent: string,
    world: WorldSnapshot,
    onText: (delta: string) => void,
  ): Promise<TurnResult> {
    this.history.push({ role: "user", content: userContent });

    let text = "";
    const actions: AppliedAction[] = [];
    // On trade/training turns, hold each round's text until the round ends: if the
    // model made an offer, what it said *before* the game set the terms may be wrong
    // ("8 hours for 80 gold" when the game offered 4h for 40), so it's dropped and the
    // model states the real terms in the next round.
    const hold = this.tradeTalk || this.trainingTalk || this.questTalk;

    for (let step = 0; step < config.maxStepsPerTurn; step++) {
      let roundText = "";
      const emit = (delta: string) => {
        text += delta;
        onText(delta);
      };
      const tools = toolsFor(this.context(world));
      this.fitContext(tools);
      let moodFilter!: LeadingMoodFilter;
      let result: ChatResult | undefined;
      for (let attempt = 0; !result; attempt++) {
        let streamed = false;
        roundText = "";
        moodFilter = new LeadingMoodFilter((delta) => {
          streamed = true;
          if (hold) roundText += delta;
          else emit(delta);
        });
        try {
          const sent = this.history.length;
          result = await this.llm.chat(
            { system: this.system, messages: this.history, tools, maxTokens: this.maxTokens },
            (delta) => moodFilter.push(delta),
          );
          if (result.stats?.inputTokens) this.measured = { tokens: result.stats.inputTokens, messages: sent };
        } catch {
          // Retry once, but only if the player hasn't seen any of the reply: a retry would repeat it.
          if (attempt < config.llmRetries && !(streamed && !hold)) continue;
          const fallback = this.persona.fallbackLine ?? "I need a moment before I can answer that.";
          emit(text ? ` ${fallback}` : fallback);
          this.history.push({ role: "assistant", content: fallback });
          return { text, actions };
        }
      }
      moodFilter.end();

      // A mood written as text ("Annoyed. ...") counts as a change_mood call.
      if (moodFilter.mood) {
        const outcome = applyAction({ ok: true, name: "change_mood", args: { mood: moodFilter.mood } }, this.context(world));
        actions.push({ name: "change_mood", args: { mood: moodFilter.mood, fromText: true }, ...outcome });
      }

      const madeOffer = result.toolCalls.some((c) => OFFER_TOOLS.has(c.name));
      const dropText = hold && madeOffer;
      if (hold && !dropText && roundText) emit(roundText);

      this.history.push({
        role: "assistant",
        // Store the cleaned text so the model doesn't learn the habit from its own history,
        // and nothing at all if it was dropped (so it doesn't remember quoting wrong terms).
        content: dropText
          ? ""
          : result.text.startsWith(moodFilter.removed)
            ? result.text.slice(moodFilter.removed.length)
            : result.text,
        toolCalls: result.toolCalls,
      });

      if (result.toolCalls.length === 0) break; // nothing to act on: she's done talking

      for (const call of result.toolCalls) {
        const parsed = parseAction(call.name, call.arguments);
        const alreadyAttacked = call.name === "attack_player" && actions.some((a) => a.name === "attack_player" && a.ok);
        const outcome = !parsed.ok
          ? { ok: false, message: `Invalid action: ${parsed.error}` }
          : alreadyAttacked
            ? { ok: false, message: "You already attacked this turn." }
            : applyAction(parsed, this.context(world));
        actions.push({ name: call.name, args: call.arguments, ...outcome });
        this.history.push({ role: "tool", toolName: call.name, content: outcome.message });
      }
      // Loop again so the NPC can react to the tool results (and say her line).
    }

    return { text, actions };
  }

  /**
   * Prompt tokens the next request will take. The larger of a character-based estimate
   * and the model's own count of the last request (prompt_eval_count) plus an estimate
   * for what's been added since, so a low count (e.g. from prompt caching) can't hide growth.
   */
  requestTokens(tools: ToolDef[] = []): number {
    const estimate = estimateRequest(this.system, this.history, tools);
    if (!this.measured) return estimate;
    const added = this.history.slice(this.measured.messages).reduce((sum, m) => sum + estimateMessage(m), 0);
    return Math.max(estimate, this.measured.tokens + added);
  }

  /**
   * Keep the request under config.contextTokenBudget. Past numCtx, Ollama silently drops
   * the *start* of the prompt, system prompt included. Drops the oldest whole exchanges
   * (a player line or event, with every reply, tool call and tool result after it), so a
   * tool result is never left without its call. The exchange in progress is always kept.
   * Later (N5) dropped exchanges should be summarised into memories instead.
   */
  private fitContext(tools: ToolDef[]): void {
    while (this.requestTokens(tools) > config.contextTokenBudget) {
      const next = this.history.findIndex((m, i) => i > 0 && m.role === "user");
      if (next < 0) break;
      const dropped = this.history.splice(0, next);
      if (this.measured) {
        const messages = this.measured.messages - dropped.length;
        const tokens = this.measured.tokens - dropped.reduce((sum, m) => sum + estimateMessage(m), 0);
        this.measured = messages > 0 && tokens > 0 ? { tokens, messages } : null;
      }
    }
  }
}
