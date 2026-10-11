/** Small DOM helpers. Text from the model is only ever inserted with textContent. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} is missing from index.html`);
  return el as T;
};

/** Copper → "1 gold 2 silver 5 copper" (the server counts all money in copper; 1 gold = 10 silver = 100 copper). */
export const coins = (copper: number): string => {
  const g = Math.floor(copper / 100),
    s = Math.floor((copper % 100) / 10),
    c = copper % 10;
  return [g && `${g} gold`, s && `${s} silver`, c && `${c} copper`].filter(Boolean).join(" ") || "0 copper";
};

/** Short money for floating numbers: "4g 2s 5c". */
export const shortCoins = (copper: number): string => {
  const g = Math.floor(copper / 100),
    s = Math.floor((copper % 100) / 10),
    c = copper % 10;
  return [g && `${g}g`, s && `${s}s`, c && `${c}c`].filter(Boolean).join(" ") || "0c";
};

export const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] =>
  Object.assign(document.createElement(tag), props);

export const emptyP = (t: string) => el("p", { className: "empty", textContent: t });
