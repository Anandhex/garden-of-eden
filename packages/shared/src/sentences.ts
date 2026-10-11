/**
 * Splitting streamed NPC text into sentences, so speech can start on the first one
 * while the model is still writing the rest (T14).
 */

/** Words ending in a full stop that don't end a sentence. */
const ABBREVIATIONS = new Set(["mr", "mrs", "ms", "dr", "st", "sgt", "cpl", "capt", "lt", "mt", "no", "vs", "etc", "e.g", "i.e"]);

/** Shortest piece worth speaking on its own; shorter ones wait for the next sentence. */
const MIN_CHARS = 12;

/**
 * Feed text as it streams in; get back each sentence once it's complete.
 * `flush()` returns whatever is left when the reply ends.
 */
export class SentenceSplitter {
  private buffer = "";

  push(delta: string): string[] {
    this.buffer += delta;
    const out: string[] = [];
    for (;;) {
      let end = findSentenceEnd(this.buffer);
      if (end < 0) break;
      // A very short piece ("Hm.") joins the next sentence instead of being spoken alone.
      while (this.buffer.slice(0, end).trim().length < MIN_CHARS) {
        const next = findSentenceEnd(this.buffer.slice(end));
        if (next < 0) break;
        end += next;
      }
      const sentence = this.buffer.slice(0, end).trim();
      if (sentence.length < MIN_CHARS) break;
      this.buffer = this.buffer.slice(end);
      out.push(sentence);
    }
    return out;
  }

  flush(): string[] {
    const rest = this.buffer.trim();
    this.buffer = "";
    return rest ? [rest] : [];
  }
}

/** Index just past the end of the first complete sentence in `text`, or -1. */
export function findSentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === "\n") {
      if (text.slice(0, i).trim()) return i + 1;
      continue;
    }
    if (ch !== "." && ch !== "!" && ch !== "?" && ch !== "…") continue;
    // Swallow runs like "?!", "..." and closing quotes or brackets.
    let j = i + 1;
    while (j < text.length && /[.!?…"'”’)\]*]/.test(text[j]!)) j++;
    // We need to see what comes next to know it's an end: more text still streaming.
    if (j >= text.length) return -1;
    if (!/\s/.test(text[j]!)) continue; // "3.5", "e.g.x"
    if (ch === ".") {
      const word = /([A-Za-z.]+)$/.exec(text.slice(0, i))?.[1]?.toLowerCase();
      if (word && (ABBREVIATIONS.has(word) || /^[a-z]$/i.test(word))) continue; // "Mr.", initials
    }
    return j;
  }
  return -1;
}

/**
 * What a voice should actually say: no stage directions ("*wipes her hands*"),
 * no markup, no speaker labels.
 */
export function speakable(text: string): string {
  return text
    .replace(/\*[^*]*\*/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[*_#`~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[A-Z][a-z]+:\s+/, "");
}
