import { config } from "../config.js";
import { defaultRng, type Rng } from "../game/dice.js";
import { acceptQuest, isQuestTalk, refreshNeedQuests, type TurnInResult, turnInQuests } from "../game/quests.js";
import { busyWith, passTime } from "../game/simulation.js";
import { isTrainingTalk, type TrainingResult, train } from "../game/training.js";
import type { ChatMessage, LLMProvider } from "../llm/provider.js";
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
  npcAttack,
  isPleading,
  playerFlee,
  type SocialKind,
  socialCheck,
  toolsFor,
} from "./actions.js";
import { LeadingMoodFilter } from "./moodPrefix.js";
import { buildEventMessage, buildSystemPrompt, buildTurnMessage } from "./persona.js";
import { createNpcState } from "./state.js";
import type {
  AppliedAction,
  NpcPersona,
  NpcState,
  TurnResult,
  WorldSnapshot,
} from "./types.js";

/** Tools that make an offer whose terms the game sets or checks. */
const OFFER_TOOLS = new Set(["offer_item", "offer_to_buy", "offer_training", "offer_job"]);

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

  constructor(
    readonly persona: NpcPersona,
    private readonly llm: LLMProvider,
    /** Dice for checks and attacks. Pass a fixed one in tests. */
    private readonly rng: Rng = defaultRng,
  ) {
    this.state = createNpcState(persona);
    this.system = buildSystemPrompt(persona);
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
    const turn = await this.withTopic(topic, () =>
      this.runTurn(buildTurnMessage(this.persona, this.state, world, playerLine, topic), world, onText),
    );
    this.pleading = false;
    return this.continueFight(turn, world);
  }

  /**
   * In a fight the NPC strikes every turn, whatever the player does, until someone
   * dies, flees, or the NPC ends it (end_fight). Skipped if it already attacked
   * this turn (e.g. its first strike via attack_player). The roll happens in code.
   */
  private continueFight(turn: TurnResult, world: WorldSnapshot): TurnResult {
    const s = this.state;
    if (!s.inCombat || s.outcome || world.player.hp <= 0) return turn;
    if (turn.actions.some((a) => a.name === "attack_player" && a.ok)) return turn;
    const hit = npcAttack(this.context(world));
    return { ...turn, actions: [...turn.actions, { name: "attack_player", args: { automatic: true }, ...hit }] };
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
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, flee.message), world, onText);
    return { ...turn, flee };
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
    return { ...turn, quest: quest?.title ?? null };
  }

  /** The player turned down the NPC's quest offer. */
  async declineQuest(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    this.state.pendingQuest = null;
    const event = `${world.player.name} turned down your job.`;
    return this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
  }

  /** The player hands in finished quests. Rewards are paid in code; the NPC reacts if anything was handed in. */
  async turnIn(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { turnIn: TurnInResult }> {
    const result = turnInQuests(this.persona, this.state, world);
    if (result.completed.length === 0) return { text: "", actions: [], turnIn: result };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message), world, onText);
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
    return { ...turn, sale };
  }

  /** The player declined the pending offer: clear it, then let the NPC react. */
  async declineOffer(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    const result = declineOffer(this.context(world));
    return this.runTurn(buildEventMessage(this.persona, this.state, world, result.message, true), world, onText);
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
    // The NPC strikes back automatically (unless it fled or ended the fight).
    return { ...this.continueFight(turn, world), hit };
  }

  /** The player accepted the NPC's offer to buy their item: complete it in code, then let the NPC react. */
  async acceptPurchase(
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
  ): Promise<TurnResult & { sale: ActionResult }> {
    const sale = acceptPurchase(this.context(world));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, sale.message, true), world, onText);
    return { ...turn, sale };
  }

  /** The player turned down the NPC's offer to buy: clear it, then let the NPC react. */
  async declinePurchase(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    const result = declinePurchase(this.context(world));
    return this.runTurn(buildEventMessage(this.persona, this.state, world, result.message, true), world, onText);
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
    return this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
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
      const moodFilter = new LeadingMoodFilter((delta) => {
        if (hold) roundText += delta;
        else emit(delta);
      });
      const result = await this.llm.chat(
        {
          system: this.system,
          messages: this.history,
          tools: toolsFor(this.context(world)),
        },
        (delta) => moodFilter.push(delta),
      );
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
}
