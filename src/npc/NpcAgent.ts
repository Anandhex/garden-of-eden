import { config } from "../config.js";
import { payDebts } from "../game/debts.js";
import { defaultRng, type Rng } from "../game/dice.js";
import { type UseResult, useHealingItem } from "../game/healing.js";
import { resolveItem } from "../game/items.js";
import { acceptQuest, describeObjective, isQuestTalk, refreshNeedQuests, type TurnInResult, turnInQuests } from "../game/quests.js";
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
  repairForPlayer,
  type SocialKind,
  socialCheck,
  toolsFor,
} from "./actions.js";
import { LeadingMoodFilter } from "./moodPrefix.js";
import { buildEventMessage, buildSystemPrompt, buildTurnMessage } from "./persona.js";
import { XP } from "../game/life.js";
import { rankForLevel } from "../game/levels.js";
import { NEAR_DEATH_SHARE, playerWonFight } from "../game/titles.js";
import { createNpcState, npcGainXp, npcHasRoom, npcOvercome, statsOf } from "./state.js";
import { replyTokenFactor, traitsOf } from "./traits.js";
import type {
  AppliedAction,
  DefeatResult,
  NpcPersona,
  NpcState,
  TurnResult,
  WorldSnapshot,
} from "./types.js";
import { formatMoney, parseMoney } from "../game/money.js";
import { playerHasRoom } from "../game/gear.js";
import { itemLabel, itemValue } from "../game/items.js";
import { absoluteHour } from "../game/clock.js";
import { collectCommission, type CollectResult, type CommissionQuote, orderCommission } from "../game/commissions.js";
import { settlePlayerPromise } from "../game/commitments.js";
import { tellLie, type LieResult } from "../game/deception.js";
import { recordEvent } from "../game/events.js";
import { type FavourKind, type FavourQuote, grantFavour, isFavourTalk, loanDue, offerFavour, retrieveHidden } from "../game/favours.js";
import { note } from "../game/journal.js";
import { acceptService, isServiceTalk, type ServiceResult } from "../game/services.js";
import { addEmotion } from "./emotions.js";
import { fireOpening, initiativeFor, type InitiativeTrigger } from "./initiative.js";
import { remember } from "./memory.js";
import { detectIntroduction, introduce, markMet, maskPlayerName } from "./names.js";
import { adjust, AFFECTION, amendsFine, holdsGrudge, settleGrudge, TALK_AFFECTION_PER_DAY } from "./relationship.js";
import { giftTrust, lovedItem, reactToTriggers } from "./triggers.js";
import { isAmendsTalk, setMood } from "./actions.js";

/** In-game minutes a repair takes. */
export const REPAIR_MINUTES = 30;

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
  /** Whether the current player line sounds sorry (gates make_amends). */
  private amendsTalk = false;
  /** Whether the current player line asks a favour (gates offer_favour). */
  private favourTalk = false;
  /** Whether the current player line asks for a room or healing (gates offer_service). */
  private serviceTalk = false;
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

  /** What the NPC is busy with (making something, or asleep), or null if they're free to talk. The game shouldn't let the player interact while busy. */
  busyWith(world: WorldSnapshot): string | null {
    const job = busyWith(this.state, world);
    if (job) return job;
    // Asleep this hour (game/schedule.ts): only once an hour's tick has put them to bed.
    const a = this.state.activity;
    if (a && a.activity === "sleep" && a.at === absoluteHour(world) && !this.state.inCombat) return "asleep";
    return null;
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
    this.amendsTalk = isAmendsTalk(playerLine);
    this.favourTalk = isFavourTalk(playerLine);
    this.serviceTalk = isServiceTalk(playerLine);
    // Before the model sees anything: a name they're told, vouches they've heard, fears and loves.
    const name = detectIntroduction(playerLine);
    if (name) introduce(this.persona, this.state, world.player, name, world.day);
    this.applyVouches(world);
    const triggered = this.state.inCombat ? { lines: [], mood: null } : reactToTriggers(this.persona, this.state, world, playerLine);
    if (triggered.mood && triggered.mood !== this.state.mood && !(triggered.mood === "happy" && this.state.mood !== "neutral")) {
      setMood(this.state, triggered.mood);
    }
    const fighting = this.state.inCombat;
    const turn = await this.withTopic(topic, () =>
      this.runTurn(buildTurnMessage(this.persona, this.state, world, playerLine, topic, triggered.lines), world, onText),
    );
    this.pleading = false;
    this.amendsTalk = false;
    this.favourTalk = false;
    this.serviceTalk = false;
    if (!turn.fallback) {
      if (!fighting) this.rememberTone(turn, playerLine, world);
      this.spentTimeTogether(world);
    }
    const result = this.continueFight(turn, world);
    this.spend(world, fighting || this.state.inCombat ? "fight" : "talk");
    return result;
  }

  /**
   * What the player's words did, as the NPC's own mood call showed it (N5): a hostile
   * mood after their line is an insult remembered (worse in front of others); a happy
   * one, a kindness. Once a day each; the memory is written by code, not the model.
   */
  private rememberTone(turn: TurnResult, playerLine: string, world: WorldSnapshot): void {
    const moods = turn.actions.filter((a) => a.name === "change_mood" && a.ok).map((a) => (a.args as { mood?: string }).mood);
    const quote = playerLine.length > 80 ? `${playerLine.slice(0, 77)}...` : playerLine;
    const traits = traitsOf(this.persona);
    const publicly = (world.present ?? []).length > 0;
    if (moods.includes("angry") || moods.includes("annoyed")) {
      const angry = moods.includes("angry");
      remember(this.state, { id: `insulted-${world.day}`, day: world.day, text: `they insulted you${publicly ? " in front of others" : ""}: "${quote}"`, importance: angry ? 6 : 4, valence: -1 }, traits);
      addEmotion(this.state, "resentment", (angry ? 0.5 : 0.3) + (publicly ? 0.2 : 0), `them insulting you${publicly ? " in front of others" : ""}`, world.day, true);
      if (publicly) addEmotion(this.state, "embarrassment", 0.4, "being insulted in front of others", world.day, true);
      adjust(this.state, "affection", AFFECTION.insult);
      recordEvent(world, { kind: "insulted", actor: "player", target: this.persona.id, details: playerLine, importance: angry ? 6 : 4 });
    } else if (moods.includes("happy")) {
      remember(this.state, { id: `kind-${world.day}`, day: world.day, text: `they were kind to you: "${quote}"`, importance: 3, valence: 1 }, traits);
      adjust(this.state, "affection", AFFECTION.gift);
      recordEvent(world, { kind: "complimented", actor: "player", target: this.persona.id, details: playerLine, importance: 3 });
    }
  }

  /** Time together builds affection, a little, a few times a day; and now they've met. */
  private spentTimeTogether(world: WorldSnapshot): void {
    const key = `talk:${world.day}`;
    const times = this.state.triggerDay[key] ?? 0;
    if (times < TALK_AFFECTION_PER_DAY && !this.state.inCombat && this.state.relationship >= 0) {
      adjust(this.state, "affection", AFFECTION.talk);
      this.state.triggerDay[key] = times + 1;
    }
    for (const k of Object.keys(this.state.triggerDay)) if (k.startsWith("talk:") && k !== key) delete this.state.triggerDay[k];
    markMet(this.state, world.day);
  }

  /** NPCs who vouched for the player (the vouch favour) lift this NPC's trust, once each. */
  private applyVouches(world: WorldSnapshot): void {
    for (const voucher of world.player.vouchedBy ?? []) {
      if (voucher === this.persona.name || this.state.vouchedDay[voucher] !== undefined) continue;
      this.state.vouchedDay[voucher] = world.day;
      adjust(this.state, "trust", 5);
    }
  }

  /**
   * Speak first, if a trigger says so (npc/initiative.ts): a promise due, a job
   * they gave you, a grudge, a greeting. Null if they have nothing to open with.
   */
  async speakFirst(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<(TurnResult & { trigger: InitiativeTrigger }) | null> {
    if (this.isDead || this.busyWith(world)) return null;
    const opening = initiativeFor(this.persona, this.state, world);
    if (!opening) return null;
    const event = fireOpening(this.persona, this.state, world, opening);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${event} Speak first: one short line.`), world, onText);
    markMet(this.state, world.day);
    return { ...turn, trigger: opening.trigger };
  }

  /** Chime in on a group scene (game/scene.ts) with one line, reacting to what was just said. */
  async interject(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    if (this.isDead || this.busyWith(world)) return { text: "", actions: [] };
    const event = `You're nearby and heard that. Chime in with one short line if you have something to say, to ${world.player.name} or the others.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /** The player introduces themselves (/introduce): the NPC learns their name and reacts. */
  async introduceSelf(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    introduce(this.persona, this.state, world.player, world.player.name, world.day);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${world.player.name} tells you their name: ${world.player.name}.`), world, onText);
    markMet(this.state, world.day);
    this.spend(world, "talk");
    return turn;
  }

  /**
   * The player gives the NPC something (/give): an item or money ("2 silver"). Trust
   * comes from the value, much more for something they love (npc/triggers.ts); a gift
   * worth the amends fine settles a grudge. The NPC reacts.
   */
  async receiveGift(what: string, world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { gift: { ok: boolean; message: string; trust: number } }> {
    const player = world.player;
    const fail = (message: string) => ({ text: "", actions: [], gift: { ok: false, message, trust: 0 } });
    if (this.state.inCombat) return fail("Not in the middle of a fight.");
    const money = parseMoney(what);
    const item = money === null ? (resolveItem(player.inventory, what) ?? null) : null;
    if (money === null && !item) return fail(`You don't have ${what}.`);
    if (money !== null && (money <= 0 || money > player.money)) return fail(`You don't have ${formatMoney(Math.max(0, money))} to give.`);
    if (item && !npcHasRoom(this.persona, this.state, { [item]: 1 })) return fail(`${this.persona.name} has no room for it.`);
    const trust = giftTrust(this.persona, this.state, item ? { item } : { money: money! }, world.day);
    const loved = item ? lovedItem(this.persona, item) : undefined;
    if (item) {
      player.inventory[item] = (player.inventory[item] ?? 0) - 1;
      if (player.inventory[item] === 0) delete player.inventory[item];
      this.state.inventory[item] = (this.state.inventory[item] ?? 0) + 1;
    } else {
      player.money -= money!;
      this.state.money += money!;
      payDebts(this.persona, this.state);
    }
    adjust(this.state, "trust", trust);
    adjust(this.state, "affection", loved ? AFFECTION.lovedGift : AFFECTION.gift);
    this.state.lastGiftReceivedDay = world.day;
    const value = item ? (itemValue(item) ?? 0) : money!;
    const settles = holdsGrudge(this.state, world.day) && value >= amendsFine(this.persona);
    if (settles) settleGrudge(this.state);
    const what_ = item ? `a ${itemLabel(item)}` : formatMoney(money!);
    if (loved) {
      addEmotion(this.state, "joy", 0.5, `the ${loved.name} they gave you`, world.day, true);
      note(player, { id: `love:${this.persona.id}:${loved.name}`, day: world.day, npc: this.persona.id, kind: "love", text: `${this.persona.name} loves ${loved.name}.` });
    }
    remember(this.state, { id: `gift-${world.day}`, day: world.day, text: `they gave you ${what_}${loved ? `, and you love ${loved.name}` : ""}`, importance: loved ? 6 : 4, valence: 1 }, traitsOf(this.persona));
    recordEvent(world, { kind: "gift", actor: "player", target: this.persona.id, details: what_, importance: loved ? 6 : 4 });
    const event = `${player.name} gave you ${what_} as a gift.${loved ? ` You love ${loved.name}!` : ""}${settles ? " It's enough to make up for what they did; you let the grudge go." : ""}`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return { ...turn, gift: { ok: true, trust, message: `You gave ${this.persona.name} ${what_}.${loved ? " They love it." : ""}` } };
  }

  /** The player tells a lie (/lie). Rolled in code (game/deception.ts); the NPC reacts. */
  async hearLie(claim: string, world: WorldSnapshot, onText: (delta: string) => void = () => {}, onRoll: (r: LieResult) => void = () => {}): Promise<TurnResult & { lie: LieResult }> {
    const result = tellLie(this.persona, this.state, world, claim, this.rng);
    onRoll(result);
    if (!result.ok) return { text: "", actions: [], lie: result };
    if (!result.believed) setMood(this.state, "annoyed", traitsOf(this.persona));
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message), world, onText);
    this.spend(world, "talk");
    return { ...turn, lie: result };
  }

  /** The player asks a favour (/ask). Code decides (game/favours.ts); the NPC offers the terms or turns them down. */
  async askFavour(kind: FavourKind, world: WorldSnapshot, item?: string, onText: (delta: string) => void = () => {}): Promise<TurnResult & { favour: FavourQuote }> {
    const quote = offerFavour(this.persona, this.state, world, kind, item);
    const asked = `${world.player.name} asked you a favour (${kind.replace("_", " ")}).`;
    const event = quote.ok
      ? `${asked} You're willing: you'll ${quote.message}. Say these terms; they'll accept or decline, and they'll owe you one.`
      : `${asked} You won't: ${quote.message} Turn them down.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event), world, onText);
    this.spend(world, "talk");
    return { ...turn, favour: quote };
  }

  /** The player accepted the favour on offer: it's done, and they owe one back. */
  async acceptFavour(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { favour: { ok: boolean; message: string } }> {
    const result = grantFavour(this.persona, this.state, world);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, result.message), world, onText);
    this.spend(world, "talk");
    return { ...turn, favour: result };
  }

  /** The player turned down the favour on offer. */
  async declineFavour(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    this.state.pendingFavour = null;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${world.player.name} changed their mind about the favour.`), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /** The player pays the fine the NPC named to settle a grudge (make_amends). */
  async acceptAmends(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { amends: { ok: boolean; message: string } }> {
    const offer = this.state.pendingAmends;
    const player = world.player;
    const fail = (message: string) => ({ text: "", actions: [], amends: { ok: false, message } });
    if (!offer) return fail("Nothing to settle.");
    if (player.money < offer.fine) return fail(`It costs ${formatMoney(offer.fine)}; you have ${formatMoney(player.money)}.`);
    player.money -= offer.fine;
    this.state.money += offer.fine;
    payDebts(this.persona, this.state);
    settleGrudge(this.state);
    recordEvent(world, { kind: "amends", actor: "player", target: this.persona.id, details: formatMoney(offer.fine), importance: 5 });
    remember(this.state, { id: `amends-${world.day}`, day: world.day, text: `they paid ${formatMoney(offer.fine)} to make amends`, importance: 5, valence: 1 }, traitsOf(this.persona));
    const message = `${player.name} paid you ${formatMoney(offer.fine)} to make amends. The grudge is settled.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, message), world, onText);
    this.spend(world, "talk");
    return { ...turn, amends: { ok: true, message } };
  }

  /** The player won't pay the fine. */
  async declineAmends(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    this.state.pendingAmends = null;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${world.player.name} won't pay to make amends.`), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /**
   * The player accepted a service (heal, lodging): charged once, applied in code. For
   * lodging, `sleepHours` says how long the caller should let the village live while they sleep.
   */
  async acceptService(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { service: ServiceResult }> {
    const result = acceptService(this.persona, this.state, world);
    if (!result.ok) return { text: "", actions: [], service: result };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${result.message} Say a line as you do it.`, true), world, onText);
    this.spend(world, "trade");
    return { ...turn, service: result };
  }

  /** The player turned down a service. */
  async declineService(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult> {
    this.state.pendingService = null;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${world.player.name} doesn't want that after all.`), world, onText);
    this.spend(world, "talk");
    return turn;
  }

  /** The player orders something (/commission): the deposit is paid and the NPC names a time. */
  async commission(item: string, world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { order: CommissionQuote }> {
    const order = orderCommission(this.persona, this.state, world, item);
    if (!order.ok) return { text: "", actions: [], order };
    const event = `${world.player.name} ordered ${order.message}, and paid the deposit. Promise them it'll be ready by then.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event, true), world, onText);
    this.spend(world, "trade");
    return { ...turn, order };
  }

  /** The player collects a finished commission (/collect). */
  async collect(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { collect: CollectResult }> {
    const late = this.state.commission?.late === true;
    const result = collectCommission(this.persona, this.state, world);
    if (!result.ok) return { text: "", actions: [], collect: result };
    const event = `${result.message}${late ? " You finished it late; you already took some off." : ""} Hand it over with a line.`;
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, event, true), world, onText);
    this.spend(world, "trade");
    return { ...turn, collect: result };
  }

  /** The player repays a loan (/repay): on time keeps their word; late still settles it. */
  async repay(world: WorldSnapshot, onText: (delta: string) => void = () => {}): Promise<TurnResult & { repay: { ok: boolean; message: string } }> {
    const loan = loanDue(world.player, this.persona.id);
    const fail = (message: string) => ({ text: "", actions: [], repay: { ok: false, message } });
    if (!loan || !loan.amount) return fail(`You don't owe ${this.persona.name} anything.`);
    if (world.player.money < loan.amount) return fail(`You owe ${formatMoney(loan.amount)}; you have ${formatMoney(world.player.money)}.`);
    world.player.money -= loan.amount;
    this.state.money += loan.amount;
    payDebts(this.persona, this.state);
    const line = settlePlayerPromise(this.persona, this.state, loan, world);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${world.player.name} paid back the ${formatMoney(loan.amount)} you lent them. ${line}`), world, onText);
    this.spend(world, "trade");
    return { ...turn, repay: { ok: true, message: `You paid ${this.persona.name} back ${formatMoney(loan.amount)}. ${line}` } };
  }

  /** The player takes back what the NPC hid for them (/retrieve). No model call. */
  retrieve(world: WorldSnapshot): { ok: boolean; message: string } {
    return retrieveHidden(this.persona, this.state, world.player);
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
   * - "knockout": the NPC takes a share of their money, time passes while they're out
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
    // Winning a fight makes them stronger; a tougher player is worth more. It's also a challenge overcome.
    const grew = this.wonFight(world, `beating ${player.name} in a fight`, XP.winFight + 5 * player.level);

    if (config.playerDefeat === "permadeath") {
      s.outcome = "killed player";
      player.death = { day: world.day, hour: world.hour, killedBy: this.persona.name };
      remember("killed-player", `You killed ${player.name} in a fight on day ${world.day}.`);
      return { rule: "permadeath", moneyTaken: 0, hoursOut: 0, log: grew, message: `${this.persona.name} killed ${player.name}.` };
    }

    s.outcome = "knocked out";
    const moneyTaken = Math.floor(player.money * config.knockoutMoneyShare);
    player.money -= moneyTaken;
    s.money += moneyTaken;
    payDebts(this.persona, s);
    remember(
      `beat-player-day-${world.day}`,
      `You beat ${player.name} in a fight on day ${world.day}${moneyTaken > 0 ? ` and took ${formatMoney(moneyTaken)} off them` : ""}.`,
    );
    const hoursOut = config.knockoutRecoveryHours;
    const log = [...grew, ...passTime(this.persona, s, world, hoursOut, this.rng)];
    player.hp = Math.max(1, Math.ceil(player.maxHp * config.knockoutHpShare));
    return {
      rule: "knockout",
      moneyTaken,
      hoursOut,
      log,
      message:
        `${this.persona.name} knocked you out. You wake ${hoursOut} hours later with ${player.hp}/${player.maxHp} HP` +
        (moneyTaken > 0 ? `, ${formatMoney(moneyTaken)} lighter.` : "."),
    };
  }

  /**
   * The NPC came out on top of a fight: XP, and a challenge at the player's rank
   * (from their level). Winning while near death counts for more. Returns log lines.
   */
  private wonFight(world: WorldSnapshot, what: string, xp: number): string[] {
    const s = this.state;
    const ready = npcGainXp(this.persona, s, xp);
    const nearDeath = s.hp <= statsOf(this.persona, s).maxHp * NEAR_DEATH_SHARE;
    const grew = npcOvercome(this.persona, s, { kind: "fight", rank: rankForLevel(world.player.level), nearDeath, what }, world.day);
    return [...(ready ? [ready] : []), ...grew];
  }

  /**
   * After the player's attack: if the NPC died, ran (by a failed morale roll or the
   * flee tool) or begged, the player won the fight. Returns any titles they earned.
   */
  private playerWon(world: WorldSnapshot, hit: { begged?: boolean }): { titles?: string[]; spoils?: string[] } {
    const s = this.state;
    if (!(s.outcome === "dead" || s.outcome === "fled" || hit.begged)) return {};
    const titles = playerWonFight(world.player, s.life.tier, world.day);
    const spoils = s.outcome === "dead" ? this.dropSpoils(world) : [];
    return { ...(titles.length > 0 ? { titles } : {}), ...(spoils.length > 0 ? { spoils } : {}) };
  }

  /**
   * An NPC with `dropsOnDeath` (a bandit leader, not a shopkeeper) was killed by the player:
   * the player takes their purse and what fits from their pack. What doesn't fit stays on the body.
   */
  private dropSpoils(world: WorldSnapshot): string[] {
    const s = this.state;
    if (!this.persona.dropsOnDeath) return [];
    const player = world.player;
    const taken: string[] = [];
    const left: string[] = [];
    for (const [item, qty] of Object.entries(s.inventory)) {
      if (qty <= 0) continue;
      if (!playerHasRoom(player, { [item]: qty })) {
        left.push(item);
        continue;
      }
      player.inventory[item] = (player.inventory[item] ?? 0) + qty;
      delete s.inventory[item];
      taken.push(`${itemLabel(item)} x${qty}`);
    }
    if (s.money > 0) {
      taken.push(formatMoney(s.money));
      player.money += s.money;
      s.money = 0;
    }
    return [
      ...(taken.length > 0 ? [`You take from ${this.persona.name}'s body: ${taken.join(", ")}.`] : []),
      ...(left.length > 0 ? [`No room in your pack for: ${left.map(itemLabel).join(", ")}. You leave it.`] : []),
    ];
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
    if (flee.escaped) this.wonFight(world, `driving ${world.player.name} off in a fight`, XP.surviveFight);
    onRoll(flee);
    if (!flee.ok) return { text: "", actions: [], flee };
    // A failed escape gives the NPC a free hit, which may knock the player out ("Traveler collapses.") before the NPC speaks.
    const defeat = this.resolvePlayerDefeat(world);
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, flee.message), world, onText);
    this.spend(world, "fight");
    return { ...turn, flee, ...(defeat ? { defeat } : {}) };
  }

  /**
   * The player let a fight turn pass (they didn't act within config.combatTickSeconds):
   * a no-op for them, and the NPC strikes again. Done in code, with no model call.
   */
  playerHesitates(world: WorldSnapshot): TurnResult {
    if (!this.state.inCombat || this.state.outcome) return { text: "", actions: [] };
    const turn = this.continueFight({ text: "", actions: [] }, world);
    this.spend(world, "fight");
    return turn;
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
    const quest = acceptQuest(this.persona, this.state, world.player, world);
    const event = quest
      ? `${world.player.name} accepted your job "${quest.title}": ${describeObjective(quest)}.`
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
   * The player pays this NPC (a smith) to mend their gear: "weapon", "armor" or an item
   * in their pack. Done in code (repairForPlayer); it takes REPAIR_MINUTES, and the NPC reacts.
   */
  async repair(
    which: string,
    world: WorldSnapshot,
    onText: (delta: string) => void = () => {},
    onResult: (result: ActionResult & { cost: number }) => void = () => {},
  ): Promise<TurnResult & { repair: ActionResult & { cost: number } }> {
    const result = repairForPlayer(which, this.context(world));
    onResult(result);
    if (!result.ok) return { text: "", actions: [], repair: result };
    passMinutes(this.persona, this.state, world, REPAIR_MINUTES, this.rng, { talking: true });
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, `${result.message} Say a line as you hand it back.`, true), world, onText);
    return { ...turn, repair: result };
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
    if (this.isDead) return { text: "", actions: [], hit, ...this.playerWon(world, hit) };
    const turn = await this.runTurn(buildEventMessage(this.persona, this.state, world, hit.message), world, onText);
    // The NPC strikes back automatically (unless it fled, begged or ended the fight).
    const result = { ...this.continueFight(turn, world), hit, ...this.playerWon(world, hit) };
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
      ? `${world.player.name} turned down your offer to teach ${offer.skill.replace("_", "-")} for ${formatMoney(offer.cost)}.`
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
      amendsTalk: this.amendsTalk,
      favourTalk: this.favourTalk,
      serviceTalk: this.serviceTalk,
    };
  }

  /** Anything the model reads: the player's real name swapped for what this NPC knows them as (npc/names.ts). */
  private mask(text: string, world: WorldSnapshot): string {
    return maskPlayerName(text, world.player, this.state);
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
    this.history.push({ role: "user", content: this.mask(userContent, world) });

    let text = "";
    const actions: AppliedAction[] = [];
    // On trade/training turns, hold each round's text until the round ends: if the
    // model made an offer, what it said *before* the game set the terms may be wrong
    // ("8 hours for 8 gold" when the game offered 4h for 4), so it's dropped and the
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
          return { text, actions, fallback: true };
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
        this.history.push({ role: "tool", toolName: call.name, content: this.mask(outcome.message, world) });
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
