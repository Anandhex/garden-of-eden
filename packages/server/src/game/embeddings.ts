import type { Embedder } from "../llm/provider.js";

/**
 * Text → vectors, for recalling memories by meaning (game/db.ts). The real thing is
 * a small local embedding model (OllamaEmbedder, e.g. `ollama pull nomic-embed-text`).
 * Without it, a hashed bag of words stands in: crude, but fast, offline and
 * deterministic: it finds a talk about "my brother" when the player says "your brother".
 */
export const HASH_DIMS = 256;

/** Little words that carry no meaning for recall. */
const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it its this that these those you your i me my we our they them their he she his her not no yes do did does have has had what who where when why how any some about".split(" "));

function fnv(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Crude stemming: "brothers" and "brother's" count as "brother". */
function stem(w: string): string {
  return w.replace(/'s$/, "").replace(/(ing|ed|es|s)$/, (m) => (w.length > m.length + 3 ? "" : m));
}

/** A unit vector from the words (and word pairs) in `text`. */
export function hashedEmbedding(text: string, dims = HASH_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const words = text.toLowerCase().split(/[^a-z']+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  words.forEach((w, i) => {
    const h = fnv(w);
    v[h % dims]! += h & 1 ? 1 : -1;
    if (i > 0) {
      const p = fnv(`${words[i - 1]} ${w}`);
      v[p % dims]! += (p & 1 ? 1 : -1) * 0.5;
    }
  });
  return normalise(v);
}

export function normalise(v: number[]): number[] {
  const n = Math.hypot(...v);
  return n === 0 ? v : v.map((x) => x / n);
}

/** Cosine similarity of two vectors of the same length (unit vectors: their dot product). */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/** The hashed stand-in as an Embedder. */
export const hashedEmbedder: Embedder = {
  name: "hashed",
  async embed(texts: string[]) {
    return texts.map((t) => hashedEmbedding(t));
  },
};

/**
 * The best embedder available: the Ollama model if it's pulled, else the hashed
 * stand-in. `probe` is OllamaEmbedder (injected so tests never touch Ollama).
 */
export async function pickEmbedder(probe?: Embedder & { available(): Promise<boolean> }): Promise<Embedder> {
  if (probe && (await probe.available().catch(() => false))) return probe;
  return hashedEmbedder;
}
