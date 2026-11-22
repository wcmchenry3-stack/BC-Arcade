/** #2960: the score store notifies only when the integer score changes. */
import { createScoreStore } from "../scoreStore";

describe("createScoreStore", () => {
  it("notifies subscribers once per new integer, never for the same value", () => {
    const store = createScoreStore();
    const listener = jest.fn();
    store.subscribe(listener);
    store.set(0);
    store.set(0.4);
    expect(listener).not.toHaveBeenCalled();
    store.set(8);
    store.set(8);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.get()).toBe(8);
  });

  it("stops notifying after unsubscribe", () => {
    const store = createScoreStore(5);
    const listener = jest.fn();
    const off = store.subscribe(listener);
    off();
    store.set(6);
    expect(listener).not.toHaveBeenCalled();
    expect(store.get()).toBe(6);
  });
});
