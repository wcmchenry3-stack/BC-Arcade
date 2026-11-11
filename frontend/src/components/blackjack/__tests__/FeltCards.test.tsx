/**
 * #3581: a card's motion on the Blackjack felt (FeltCards): the deal's flight from off the felt,
 * a slide to a new place from where the card is shown, the hole card's turn, everything landing
 * at once on a new epoch, and the JS backstops that land a motion whose end never comes. The
 * Jest mock of Reanimated evaluates each animated style at render; `withTiming` is spied on to
 * see what was set going (and, for the backstops, never to finish).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, render, screen } from "@testing-library/react-native";

import FeltCards, { type FeltHand } from "../FeltCards";
import { PopIn } from "../FeltChips";
import { ThemeProvider } from "../../../theme/ThemeContext";
import type { CardResponse } from "../../../game/blackjack/types";
import type { CardMotion } from "../useBlackjackMotion";
import { FLIGHT_BACKSTOP_MS } from "../../cards/cardMotion";
import { DEAL_FLIGHT_MS, FLIP_MS } from "../blackjackMotion";

const reanimated = jest.requireMock<Record<string, unknown>>("react-native-reanimated");
/** Each timing set going: its target and duration. With `stall`, it never moves. */
let timings: { to: number; duration: number }[] = [];
let stall = false;

beforeEach(() => {
  timings = [];
  stall = false;
  jest.useFakeTimers();
  jest.spyOn(reanimated, "withTiming" as never).mockImplementation(((
    to: number,
    config?: { duration?: number }
  ) => {
    timings.push({ to, duration: config?.duration ?? 300 });
    // A stalled timing leaves its value where it was set (0, the start), as if its end never came.
    return stall ? 0 : to;
  }) as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const NINE: CardResponse = { rank: "9", suit: "♥", face_down: false };
const fan = (x: number) => ({
  x,
  y: 100,
  cardWidth: 50,
  cardHeight: 70,
  step: 17,
  count: 1,
  width: 50,
});
const motion = (o: Partial<CardMotion> = {}): CardMotion => ({
  dealing: new Set(),
  flipping: new Set(),
  slideMs: 240,
  epoch: 0,
  ...o,
});
const hand = (x: number, card = NINE): FeltHand => ({
  id: "hand-0",
  cards: [card],
  ids: ["c1"],
  fan: fan(x),
});
const ORIGIN = { x: 400, y: -140 };

function ui(h: FeltHand, m: CardMotion) {
  return (
    <ThemeProvider>
      <FeltCards hands={[h]} motion={m} origin={ORIGIN} />
    </ThemeProvider>
  );
}

/** The drawn card's transform, by name (the moving view inside the card's place). */
function pose(testID = "hand-0-card-0") {
  const moving = screen.getByTestId(testID).children[0] as unknown as { props: { style: unknown } };
  const style = StyleSheet.flatten(moving.props.style as never) as {
    transform: Record<string, number | string>[];
  };
  const entries = style.transform.flatMap((t) => Object.entries(t));
  // At rest an offset is 0 (or -0: a start offset times 0), compared as 0.
  return Object.fromEntries(entries.map(([k, v]) => [k, v === 0 ? 0 : v]));
}

type View = Awaited<ReturnType<typeof render>>;
let view: View;

/**
 * Draws `h` with `m`, then once more: the Jest mock evaluates an animated style at render, before
 * the effects set the motion going, so the second render shows it (`dimmed` turned on, which moves
 * nothing, gets past the card's memo; the next `show` turns it back off).
 */
async function show(h: FeltHand, m: CardMotion) {
  if (view === undefined) view = await render(ui(h, m));
  else await view.rerender(ui(h, m));
  await view.rerender(ui({ ...h, dimmed: !h.dimmed }, m));
}
const after = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe("FeltCards", () => {
  beforeEach(() => {
    view = undefined as unknown as View;
  });

  it("a card not being dealt is drawn at its place, still", async () => {
    await show(hand(20), motion());
    expect(timings).toEqual([]);
    expect(pose()).toMatchObject({ translateX: 0, translateY: 0, rotate: "0deg", scale: 1 });
  });

  it("a dealt card flies 240 ms from off the felt's top-right, turned −18°", async () => {
    stall = true;
    await show(hand(20), motion({ dealing: new Set(["c1"]) }));
    expect(timings).toEqual([{ to: 1, duration: DEAL_FLIGHT_MS }]);
    const p = pose();
    expect(p.translateX).toBe(ORIGIN.x - 20);
    expect(p.translateY).toBe(ORIGIN.y - 100);
    expect(p.rotate).toBe("-18deg");
  });

  it("a card whose place changes slides there from where it was", async () => {
    stall = true;
    await show(hand(20), motion());
    await show(hand(60), motion({ slideMs: 300 }));
    expect(timings).toEqual([{ to: 1, duration: 300 }]);
    expect(pose().translateX).toBe(-40);
  });

  it("with no slide (Reduce Motion, everything landed) a moved card jumps", async () => {
    await show(hand(20), motion({ slideMs: 0 }));
    await show(hand(60), motion({ slideMs: 0 }));
    expect(timings).toEqual([]);
    expect(pose().translateX).toBe(0);
  });

  it("the hole card turns over in 320 ms, its back showing until edge-on", async () => {
    stall = true;
    const m = motion({ flipping: new Set(["c1"]) });
    await show(hand(20, { ...NINE, face_down: true }), m);
    expect(screen.getByTestId("hand-0-card-0-outline")).toBeTruthy();
    await show(hand(20, NINE), m);
    expect(timings).toEqual([{ to: 1, duration: FLIP_MS }]);
    expect(pose().rotateY).toBe("180deg");
    expect(screen.queryByTestId("hand-0-card-0-outline")).toBeNull();
  });

  it("a hole card turned with no flip (restore, Reduce Motion) is simply face up", async () => {
    await show(hand(20, { ...NINE, face_down: true }), motion());
    await show(hand(20, NINE), motion());
    expect(timings).toEqual([]);
    expect(pose().rotateY).toBe("0deg");
  });

  it("a new epoch lands a card mid-flight at once", async () => {
    stall = true;
    await show(hand(20), motion({ dealing: new Set(["c1"]) }));
    expect(pose().translateX).toBe(ORIGIN.x - 20);
    await show(hand(20), motion({ dealing: new Set(["c1"]), epoch: 1 }));
    expect(pose()).toMatchObject({ translateX: 0, translateY: 0, rotate: "0deg" });
  });

  it("backstop: a flight whose end never comes lands FLIGHT_BACKSTOP_MS after it was due", async () => {
    stall = true;
    const m = motion({ dealing: new Set(["c1"]) });
    await show(hand(20), m);
    await after(DEAL_FLIGHT_MS + FLIGHT_BACKSTOP_MS - 1);
    await show(hand(20), m);
    expect(pose().translateX).toBe(ORIGIN.x - 20);
    await after(1);
    await show(hand(20), m);
    expect(pose()).toMatchObject({ translateX: 0, translateY: 0, rotate: "0deg" });
  });

  // #3720 review: the cards are one list, dealer then each hand, so a card dealt to hand 1 drew
  // under hand 2's cards (a split's flight passed under them). It is lifted while dealt.
  it("a card being dealt, or the hole card turning, draws above the later hands", async () => {
    const zOf = (testID: string) =>
      (StyleSheet.flatten(screen.getByTestId(testID).props.style) as { zIndex?: number }).zIndex;
    const two = (m: CardMotion) => (
      <ThemeProvider>
        <FeltCards
          hands={[
            { id: "dealer", cards: [{ ...NINE, face_down: true }], ids: ["d1"], fan: fan(20) },
            { id: "hand-0", cards: [NINE], ids: ["c1"], fan: fan(20) },
            { id: "hand-1", cards: [NINE], ids: ["c2"], fan: fan(90) },
          ]}
          motion={m}
          origin={ORIGIN}
        />
      </ThemeProvider>
    );
    const v = await render(two(motion({ dealing: new Set(["c1"]) })));
    expect(zOf("hand-0-card-0")).toBe(1);
    expect(zOf("hand-1-card-0")).toBeUndefined();
    expect(zOf("dealer-card-0")).toBeUndefined();
    await v.rerender(two(motion({ flipping: new Set(["d1"]) })));
    expect(zOf("dealer-card-0")).toBe(1);
    expect(zOf("hand-0-card-0")).toBeUndefined();
  });

  it("backstop: a turn whose end never comes shows the face", async () => {
    stall = true;
    const m = motion({ flipping: new Set(["c1"]) });
    await show(hand(20, { ...NINE, face_down: true }), m);
    await show(hand(20, NINE), m);
    expect(pose().rotateY).toBe("180deg");
    await after(FLIP_MS + FLIGHT_BACKSTOP_MS);
    await show(hand(20, NINE), m);
    expect(pose().rotateY).toBe("0deg");
  });
});

describe("PopIn", () => {
  const opacity = () =>
    (StyleSheet.flatten(screen.getByTestId("pop").props.style) as { opacity: number }).opacity;

  it("pops in when it appears with the motion, and its backstop shows it if the end never comes", async () => {
    stall = true;
    const view = await render(
      <PopIn testID="pop" animate durationMs={260} fromScale={0.9}>
        {null}
      </PopIn>
    );
    expect(timings).toEqual([{ to: 1, duration: 260 }]);
    expect(opacity()).toBe(0);
    await act(async () => {
      jest.advanceTimersByTime(260 + FLIGHT_BACKSTOP_MS);
    });
    await view.rerender(
      <PopIn testID="pop" animate durationMs={260} fromScale={0.9}>
        {[]}
      </PopIn>
    );
    expect(opacity()).toBe(1);
  });

  it("a new epoch (a tap, Reduce Motion, leaving) shows it at once", async () => {
    stall = true;
    const pop = (epoch: number, children: React.ReactNode) => (
      <PopIn testID="pop" animate epoch={epoch} durationMs={260} fromScale={0.9}>
        {children}
      </PopIn>
    );
    const view = await render(pop(0, null));
    await view.rerender(pop(0, []));
    expect(opacity()).toBe(0);
    await view.rerender(pop(1, null));
    await view.rerender(pop(1, []));
    expect(opacity()).toBe(1);
  });

  it("is simply there when it appears without motion", async () => {
    await render(
      <PopIn testID="pop" animate={false} durationMs={260} fromScale={0.9}>
        {null}
      </PopIn>
    );
    expect(timings).toEqual([]);
    expect(opacity()).toBe(1);
  });
});
