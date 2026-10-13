import { config } from "../../config.js";
import { knownNameWords, unknownNames } from "../knowledge.js";
import { ADULT_WORDS } from "../templates.js";
import { ChangeSchema, type Change, type Checked, type Proposal, type ReviewInput, refsOf, refTexts } from "./types.js";

/**
 * The checks on a review's proposal (N25b step 4), before anything is applied. Both the model's proposals and code's
 * rules go through them. A change is rejected when it is not of a known shape, cites something that was not in the
 * input, names someone the person doesn't know, goes against a fact (forgiving a grudge nobody holds, a secret that
 * isn't real), or breaks a content rule. A change over a limit is clipped or dropped, with a note. Nothing
 * here is random.
 */
const ROMANCE = /\b(romance|romantic|lover|flirt\w*|seduc\w*|kiss\w*|sweetheart|courting|brothel)\b/i;

/** What is wrong with a piece of free text, or null. */
export function wordsProblem(text: string, input: ReviewInput): string | null {
  const known = knownNameWords(input.names.map((name) => ({ name })), [input.who.name, input.who.siteName]);
  const unknown = unknownNames(text, known);
  if (unknown.length > 0) return `names someone the person doesn't know: ${unknown.join(", ")}`;
  if (input.who.minor && (ADULT_WORDS.test(text) || ROMANCE.test(text))) return "adult words for a child";
  return null;
}

/** Every free-text field a change carries. */
function textsOf(c: Change): string[] {
  switch (c.kind) {
    case "opinion":
    case "goal-drop":
    case "grudge":
    case "forgive":
    case "belief":
      return [c.why];
    case "emotion":
      return [c.why, c.about];
    case "goal-add":
      return [c.why, c.words];
    case "fear":
    case "love":
      return [c.why, c.name, c.mentions.join(" ")];
    case "secret":
      return [c.why, c.about, c.text, c.cover];
    case "arc-step":
      return [c.why, c.words];
    case "story":
      return [c.why, c.words];
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const harmRef = (because: string[]) => because.some((b) => b.startsWith("e:") || b.startsWith("m:"));
/** Goals a child may be given. */
const CHILD_GOALS = new Set(["protect", "make_amends"]);

/**
 * Small, harmless fixes to how a small model fills the form in, before the strict reading: `because` as one string, a ref copied with
 * its label ("lord:fig-1 = Joan Ingle: trust 0" is the ref "lord:fig-1"), an emotion's subject under `target`. Nothing here changes what
 * a change means; a ref that is still not one of theirs after this is rejected.
 */
export function tidy(item: unknown, refs: ReadonlySet<string>, texts: ReadonlyMap<string, string> = new Map()): unknown {
  if (typeof item !== "object" || item === null) return item;
  const c = { ...(item as Record<string, unknown>) };
  const asRef = (b: unknown): unknown => {
    if (typeof b !== "string") return b;
    const t = b.trim().replace(/^\[|\]$/g, "");
    if (refs.has(t)) return t;
    const head = t.split(/\s+=\s+|\s+\(|:\s/)[0]!.trim();
    return refs.has(head) ? head : t;
  };
  if (typeof c.because === "string") c.because = [c.because];
  if (Array.isArray(c.because)) c.because = [...new Set(c.because.map(asRef))];
  if (c.kind === "emotion" && typeof c.about !== "string") c.about = typeof c.target === "string" ? c.target : typeof c.why === "string" ? c.why.slice(0, 80) : "what happened";
  if (typeof c.target === "string" && c.kind !== "goal-add") delete c.target;
  // The model is not asked to explain: the reason is what it cited (the text of the first thing the change follows from).
  if (typeof c.why !== "string" && Array.isArray(c.because)) {
    const cited = c.because.map((b) => (typeof b === "string" ? texts.get(b) : undefined)).find((t): t is string => !!t);
    if (cited) c.why = cited.slice(0, 200);
  }
  return c;
}

/** Check a proposal against the input it was made from. Pure: the same proposal and input give the same result. */
export function checkProposal(raw: Pick<Proposal, "changes"> & { malformed?: number }, input: ReviewInput, shock = input.shock !== undefined): Checked {
  const out: Checked = { accepted: [], clipped: [], rejected: [] };
  const refs = refsOf(input);
  const texts = refTexts(input);
  const max = shock ? config.review.shockMaxDelta : config.review.maxDelta;
  const subjects = new Set(input.opinions.map((o) => o.about));
  const peopleRefs = new Map(input.people.map((p) => [p.id, p]));
  const seen = new Set<string>();
  let over = 0;
  const counts: Record<string, number> = {};
  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  const known = (target: string) => subjects.has(target) || refs.has(target) || target === "player" || peopleRefs.has(target.replace(/^p:/, ""));

  for (const item of raw.changes) {
    const parsed = ChangeSchema.safeParse(tidy(item, refs, texts));
    if (!parsed.success) {
      out.rejected.push({ change: item, reason: "not a known kind of change" });
      continue;
    }
    let c: Change = parsed.data;
    const reject = (reason: string) => out.rejected.push({ change: c, reason });

    // What it follows from: every ref must be in the input.
    const lost = c.because.filter((b) => !refs.has(b));
    if (lost.length > 0) {
      reject(`cites ${lost.join(", ")}, which is not in what they were given`);
      continue;
    }
    const bad = textsOf(c).map((t) => wordsProblem(t, input)).find((p) => p !== null);
    if (bad) {
      reject(bad);
      continue;
    }
    if (out.accepted.length >= config.review.maxChanges) {
      over++;
      continue;
    }

    switch (c.kind) {
      case "opinion": {
        const key = `opinion:${c.about}:${c.axis}`;
        if (!subjects.has(c.about)) {
          reject(`has no view of "${c.about}" in play`);
          continue;
        }
        if (seen.has(key)) {
          reject("the same opinion twice");
          continue;
        }
        seen.add(key);
        if (Math.abs(c.delta) > max) {
          out.clipped.push({ kind: "opinion", note: `${c.about} ${c.axis} ${c.delta > 0 ? "+" : ""}${Math.round(c.delta)} clipped to ${c.delta > 0 ? "+" : "-"}${max}` });
          c = { ...c, delta: clamp(c.delta, -max, max) };
        }
        if (Math.round(c.delta) === 0) {
          reject("a change of nothing");
          continue;
        }
        break;
      }
      case "emotion":
        if (count("emotion") > 2) {
          out.clipped.push({ kind: "emotion", note: "dropped: more than two feelings in one review" });
          continue;
        }
        break;
      case "goal-add": {
        if (count("goal-add") > 1) {
          out.clipped.push({ kind: "goal-add", note: "dropped: one new goal a review" });
          continue;
        }
        if (input.who.goals.length >= 3) {
          reject("they already have three goals");
          continue;
        }
        if (input.who.minor && !CHILD_GOALS.has(c.goal)) {
          reject("not a goal for a child");
          continue;
        }
        // A target that isn't someone or somewhere they know of is left off (the want stands without it).
        if (c.target && !known(c.target)) {
          out.clipped.push({ kind: "goal-add", note: `target "${c.target}" left off: not someone or somewhere they know of` });
          const { target: _dropped, ...rest } = c;
          void _dropped;
          c = rest as typeof c;
        }
        if (c.goal === "pay_debt" && input.who.owed <= 0) {
          reject("they owe nothing");
          continue;
        }
        if ((c.goal === "avenge" || c.goal === "make_amends") && !harmRef(c.because)) {
          reject(`${c.goal} needs a deed or a memory behind it`);
          continue;
        }
        if (c.goal === "avenge" && !c.target) {
          reject("avenging needs someone to avenge on");
          continue;
        }
        break;
      }
      case "goal-drop": {
        const goal = c.goal;
        if (!input.who.goals.some((g) => g.id === goal)) {
          reject(`they have no goal "${goal}"`);
          continue;
        }
        break;
      }
      case "grudge": {
        if (count("grudge") > 1) {
          out.clipped.push({ kind: "grudge", note: "dropped: one new grudge a review" });
          continue;
        }
        const target = c.against === "player" ? "player" : c.against.replace(/^p:/, "");
        if (c.against !== "player" && !peopleRefs.has(target)) {
          reject(`they have no tie to "${c.against}"`);
          continue;
        }
        if (!harmRef(c.because)) {
          reject("a grudge needs a deed or a memory behind it");
          continue;
        }
        break;
      }
      case "forgive": {
        const target = c.against === "player" ? "player" : c.against.replace(/^p:/, "");
        if (target === "player" ? !input.who.grudge : (peopleRefs.get(target)?.myView.trust ?? 0) > -20) {
          reject("they hold no grudge to forgive");
          continue;
        }
        break;
      }
      case "fear":
      case "love":
        if (count(c.kind) > 1) {
          out.clipped.push({ kind: c.kind, note: `dropped: one new ${c.kind} a review` });
          continue;
        }
        if ((c.kind === "fear" ? input.who.fears : input.who.loves).length >= 4) {
          reject(`they already have four ${c.kind}s`);
          continue;
        }
        if ((c.kind === "fear" ? input.who.fears : input.who.loves).some((n) => n.toLowerCase() === (c as { name: string }).name.toLowerCase())) {
          reject("they have that already");
          continue;
        }
        c = { ...c, mentions: [...new Set(c.mentions.map((w) => w.trim().toLowerCase()).filter(Boolean))] };
        break;
      case "secret": {
        const cand = c.candidate;
        if (count("secret") > 1) {
          out.clipped.push({ kind: "secret", note: "dropped: one new secret a review" });
          continue;
        }
        if (!input.candidates.some((k) => k.ref === `k:${cand}` || k.ref === cand)) {
          reject(`"${cand}" is not something true they could keep secret`);
          continue;
        }
        if (input.who.secrets.includes(cand)) {
          reject("they keep that secret already");
          continue;
        }
        if (input.who.minor) {
          reject("not a secret for a child");
          continue;
        }
        break;
      }
      case "belief": {
        const key = c.rumour;
        if (!input.rumours.some((r) => r.ref === key || r.ref === `r:${key}`)) {
          reject(`they have not heard "${key}"`);
          continue;
        }
        break;
      }
      case "arc-step": {
        if (count("arc-step") > 1) {
          out.clipped.push({ kind: "arc-step", note: "dropped: one arc step a review" });
          continue;
        }
        const wanted = c.arc;
        const arc = input.arcs.find((a) => a.ref === wanted || a.ref === `a:${wanted}`);
        if (!arc || arc.stage + 1 >= arc.stages) {
          reject(arc ? "that arc has no further stage" : `they have no arc "${wanted}"`);
          continue;
        }
        break;
      }
      case "story":
        if (count("story") > 1) {
          out.clipped.push({ kind: "story", note: "dropped: one story line a review" });
          continue;
        }
        break;
    }
    out.accepted.push(c);
  }
  if (over > 0) out.clipped.push({ kind: "review", note: `${over} more change${over === 1 ? "" : "s"} dropped: no more than ${config.review.maxChanges} in one review` });
  if ("malformed" in raw && raw.malformed) out.rejected.push({ change: `${raw.malformed} change(s)`, reason: "not a known kind of change" });
  return out;
}
