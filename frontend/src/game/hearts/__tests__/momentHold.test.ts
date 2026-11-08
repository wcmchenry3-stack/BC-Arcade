import { createMomentHold } from "../momentHold";

describe("createMomentHold", () => {
  it("settles at once when nothing is held", async () => {
    const hold = createMomentHold();
    await expect(hold.settled()).resolves.toBeUndefined();
    expect(hold.isHeld()).toBe(false);
  });

  it("waits until every held moment is released", async () => {
    const hold = createMomentHold();
    hold.hold("queen");
    hold.hold("moon");
    let done = false;
    const waiting = hold.settled().then(() => {
      done = true;
    });

    hold.release("queen");
    await Promise.resolve();
    expect(done).toBe(false);
    expect(hold.isHeld("moon")).toBe(true);

    hold.release("moon");
    await waiting;
    expect(done).toBe(true);
    expect(hold.isHeld()).toBe(false);
  });

  it("releases everything at once (a new hand, leaving the table)", async () => {
    const hold = createMomentHold();
    hold.hold("queen");
    hold.hold("moon");
    const waiting = hold.settled();
    hold.release();
    await expect(waiting).resolves.toBeUndefined();
  });
});
