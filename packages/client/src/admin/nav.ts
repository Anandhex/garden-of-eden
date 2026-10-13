/** How views ask the page to show something (the page wires these up). */
export const nav = {
  /** Show a person's or place's card in the Pinned tab. */
  openCard: (_ref: string): void => {},
  /** Show events about a person. */
  eventsAbout: (_ref: string): void => {},
  /** Show an event's detail. */
  openEvent: (_ref: string): void => {},
};
