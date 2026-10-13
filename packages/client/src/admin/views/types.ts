import type { AdminClock } from "@millbrook/shared";

/** A tab of the admin page. `refresh` is called when it is shown and every couple of seconds while it is. */
export interface View {
  readonly el: HTMLElement;
  refresh(clock: AdminClock): Promise<void>;
}
