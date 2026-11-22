/**
 * Holds the CPU players while a table-stopping moment plays (#3588): the Queen of Spades
 * (about 2.3 s) and a mid-hand moon shot (3.7 s). A moment `hold`s by name when it starts
 * and `release`s when it ends; the AI loop awaits `settled()` before each play, so no card
 * lands under the scrim or the night sky.
 */
export interface MomentHold {
  hold(name: string): void;
  /** Ends one moment's hold, or every hold when `name` is omitted (a new hand, leaving). */
  release(name?: string): void;
  isHeld(name?: string): boolean;
  /** Resolves once nothing is held (at once when nothing is). */
  settled(): Promise<void>;
}

export function createMomentHold(): MomentHold {
  const holds = new Set<string>();
  let waiters: (() => void)[] = [];
  return {
    hold(name) {
      holds.add(name);
    },
    release(name) {
      if (name === undefined) holds.clear();
      else holds.delete(name);
      if (holds.size > 0) return;
      const ready = waiters;
      waiters = [];
      ready.forEach((resolve) => resolve());
    },
    isHeld(name) {
      return name === undefined ? holds.size > 0 : holds.has(name);
    },
    settled() {
      if (holds.size === 0) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}
