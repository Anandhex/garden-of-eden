/**
 * Pins (N17): the people and places the administrator follows. They are admin state, not
 * world state, so they live in this browser (localStorage), never in the save and never
 * on the server (a POST would make the admin view able to write).
 */
const KEY = "millbrook-admin-pins";
const listeners: Array<() => void> = [];
let memory: string[] | null = null;

function read(): string[] {
  if (memory) return memory;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    memory = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    memory = [];
  }
  return memory;
}

function write(refs: string[]): void {
  memory = refs;
  try {
    localStorage.setItem(KEY, JSON.stringify(refs));
  } catch {
    // Private windows and blocked storage: the pins last until the tab closes.
  }
  for (const l of listeners) l();
}

export const pins = {
  list: (): string[] => [...read()],
  has: (ref: string): boolean => read().includes(ref),
  add: (ref: string): void => {
    if (!read().includes(ref)) write([...read(), ref].slice(-20));
  },
  remove: (ref: string): void => write(read().filter((r) => r !== ref)),
  toggle: (ref: string): void => (pins.has(ref) ? pins.remove(ref) : pins.add(ref)),
  onChange: (fn: () => void): void => void listeners.push(fn),
};
