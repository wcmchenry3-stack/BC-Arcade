/**
 * 2048 swipe input (#3689): a swipe fires once its threshold is crossed (not on lift), once per
 * gesture, and up to two moves queue behind a slide.
 */
import { SWIPE_THRESHOLD_PX, createMoveQueue, createSwipeTracker, swipeDirection } from "../input";
import { MOVE_QUEUE_DEPTH } from "../motion";

describe("swipeDirection", () => {
  it("is null until one axis reaches the threshold", () => {
    expect(swipeDirection(0, 0)).toBeNull();
    expect(swipeDirection(SWIPE_THRESHOLD_PX - 1, SWIPE_THRESHOLD_PX - 1)).toBeNull();
    expect(swipeDirection(-(SWIPE_THRESHOLD_PX - 1), 3)).toBeNull();
  });

  it("the threshold is a short drag, 20 to 30 px", () => {
    expect(SWIPE_THRESHOLD_PX).toBeGreaterThanOrEqual(20);
    expect(SWIPE_THRESHOLD_PX).toBeLessThanOrEqual(30);
  });

  it("fires on the axis that reached it, in its direction", () => {
    expect(swipeDirection(SWIPE_THRESHOLD_PX, 0)).toBe("right");
    expect(swipeDirection(-SWIPE_THRESHOLD_PX, 4)).toBe("left");
    expect(swipeDirection(2, SWIPE_THRESHOLD_PX)).toBe("down");
    expect(swipeDirection(-2, -SWIPE_THRESHOLD_PX)).toBe("up");
  });

  it("the longer axis wins a diagonal", () => {
    expect(swipeDirection(40, 30)).toBe("right");
    expect(swipeDirection(30, -40)).toBe("up");
  });
});

describe("createSwipeTracker", () => {
  it("fires once when the drag crosses the threshold, not on every update after", () => {
    const tracker = createSwipeTracker();
    expect(tracker.update(5, 0)).toBeNull();
    expect(tracker.update(SWIPE_THRESHOLD_PX, 0)).toBe("right");
    expect(tracker.update(SWIPE_THRESHOLD_PX + 10, 0)).toBeNull();
    expect(tracker.update(-80, 0)).toBeNull(); // reversing doesn't fire a second move
  });

  it("fires again for the next gesture, after a reset", () => {
    const tracker = createSwipeTracker();
    expect(tracker.update(0, -SWIPE_THRESHOLD_PX)).toBe("up");
    tracker.reset();
    expect(tracker.update(0, SWIPE_THRESHOLD_PX)).toBe("down");
  });

  it("a drag that never reaches the threshold never fires", () => {
    const tracker = createSwipeTracker();
    for (let d = 0; d < SWIPE_THRESHOLD_PX; d += 4) expect(tracker.update(d, 0)).toBeNull();
  });
});

describe("createMoveQueue", () => {
  it("holds two moves by default, in order, and drops the third", () => {
    expect(MOVE_QUEUE_DEPTH).toBe(2);
    const queue = createMoveQueue();
    expect(queue.push("left")).toBe(true);
    expect(queue.push("up")).toBe(true);
    expect(queue.push("right")).toBe(false);
    expect(queue.length).toBe(2);
    expect(queue.shift()).toBe("left");
    expect(queue.shift()).toBe("up");
    expect(queue.shift()).toBeNull();
  });

  it("has room again after a move is taken", () => {
    const queue = createMoveQueue();
    queue.push("left");
    queue.push("up");
    queue.shift();
    expect(queue.push("down")).toBe(true);
    expect(queue.shift()).toBe("up");
    expect(queue.shift()).toBe("down");
  });

  it("clear empties it", () => {
    const queue = createMoveQueue();
    queue.push("left");
    queue.clear();
    expect(queue.length).toBe(0);
    expect(queue.shift()).toBeNull();
  });
});
