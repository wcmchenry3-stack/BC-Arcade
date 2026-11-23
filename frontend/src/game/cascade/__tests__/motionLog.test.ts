/**
 * #3701: the motion event ring the JS loop writes and the UI thread stamps with its own clock.
 */
import { MOTION } from "../motion";
import {
  MOTION_FIELD,
  MOTION_KIND,
  MOTION_SLOTS,
  MOTION_STRIDE,
  clearMotion,
  createMotionLog,
  emptyStamps,
  lastSeq,
  motionLive,
  pushMotion,
  slotAge,
  stampSlots,
} from "../motionLog";

describe("motion log", () => {
  it("writes each event into the next slot with a rising sequence number", () => {
    const log = createMotionLog();
    pushMotion(log, MOTION_KIND.merge, 10, 20, 3, 42, 2);
    expect(log.dirty).toBe(true);
    const b = log.buf;
    expect(b[MOTION_FIELD.seq]).toBe(1);
    expect(b[MOTION_FIELD.kind]).toBe(MOTION_KIND.merge);
    expect([b[MOTION_FIELD.x], b[MOTION_FIELD.y], b[MOTION_FIELD.tier]]).toEqual([10, 20, 3]);
    expect([b[MOTION_FIELD.id], b[MOTION_FIELD.aux]]).toEqual([42, 2]);
    pushMotion(log, MOTION_KIND.land, 0, 0, 0, 0, 0);
    expect(b[MOTION_STRIDE + MOTION_FIELD.seq]).toBe(2);
  });

  it("wraps around the ring, overwriting the oldest", () => {
    const log = createMotionLog();
    for (let i = 0; i < MOTION_SLOTS + 1; i++) pushMotion(log, MOTION_KIND.land, i, 0, 0, i, 0);
    expect(log.buf[MOTION_FIELD.seq]).toBe(MOTION_SLOTS + 1);
    expect(lastSeq(log.buf)).toBe(MOTION_SLOTS + 1);
  });

  it("a new game empties the slots but keeps counting, so old stamps never match", () => {
    const log = createMotionLog();
    pushMotion(log, MOTION_KIND.drop, 0, 0, 0, 0, 0);
    const stamps = stampSlots(log.buf, emptyStamps(), 100)!;
    clearMotion(log);
    expect(lastSeq(log.buf)).toBe(0);
    pushMotion(log, MOTION_KIND.drop, 0, 0, 0, 0, 0);
    expect(log.seq).toBe(2);
    expect(slotAge(log.buf, stamps, 1, 200)).toBe(-1); // slot 1: not stamped yet
  });
});

describe("UI-thread stamping", () => {
  it("stamps only events it has not seen, and allocates nothing when none are new", () => {
    const log = createMotionLog();
    pushMotion(log, MOTION_KIND.merge, 0, 0, 2, 1, 1);
    const s1 = stampSlots(log.buf, emptyStamps(), 50)!;
    expect(slotAge(log.buf, s1, 0, 80)).toBe(30);
    expect(stampSlots(log.buf, s1, 90)).toBeNull();
    pushMotion(log, MOTION_KIND.land, 0, 0, 2, 1, 20);
    const s2 = stampSlots(log.buf, s1, 100)!;
    expect(slotAge(log.buf, s2, 0, 100)).toBe(50); // the old stamp kept
    expect(slotAge(log.buf, s2, 1, 100)).toBe(0);
  });

  it("is live while any moment plays, or one is not stamped yet", () => {
    const log = createMotionLog();
    expect(motionLive(log.buf, emptyStamps(), 0, false)).toBe(false);
    pushMotion(log, MOTION_KIND.merge, 0, 0, 2, 1, 1);
    expect(motionLive(log.buf, emptyStamps(), 0, false)).toBe(true);
    const s = stampSlots(log.buf, emptyStamps(), 0)!;
    // A merge plays until its burst (#4082) has faded, after the pop's confetti.
    expect(motionLive(log.buf, s, MOTION.burst.fadeMs - 1, false)).toBe(true);
    expect(motionLive(log.buf, s, MOTION.burst.fadeMs, false)).toBe(false);
    // Reduce Motion: only the short in-place flash keeps it going.
    expect(motionLive(log.buf, s, MOTION.calm.mergeFlashMs, true)).toBe(false);
  });

  it("a landing plays nothing under Reduce Motion", () => {
    const log = createMotionLog();
    pushMotion(log, MOTION_KIND.land, 0, 0, 2, 1, 20);
    const s = stampSlots(log.buf, emptyStamps(), 0)!;
    expect(motionLive(log.buf, s, 1, true)).toBe(false);
    expect(motionLive(log.buf, s, 1, false)).toBe(true);
  });
});
