/**
 * #3621: the natural-blackjack moment's parts (owner decisions, #3739: direction B, "glint +
 * sweep"): the lift, the edge's fade-in, the sheen and the sweep worked out from the time into the
 * moment; the edges drawn static or with the moment; and the "Blackjack! 3:2" banner in every
 * locale.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { render, screen } from "@testing-library/react-native";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

import {
  edgeAt,
  glintAt,
  liftAt,
  momentElapsed,
  NaturalEdge,
  NaturalSweep,
  sweepAt,
  useNaturalLift,
} from "../NaturalMoment";
import ResultBanner from "../ResultBanner";
import FeltCards from "../FeltCards";
import { naturalColors } from "../tableColors";
import type { CardMotion } from "../useBlackjackMotion";
import type { CardResponse } from "../../../game/blackjack/types";
import * as ThemeModule from "../../../theme/ThemeContext";
import { light, ThemeProvider } from "../../../theme/ThemeContext";
import { BLACKJACK_NATURAL_GOLD, BLACKJACK_NATURAL_SILVER } from "../../../theme/theme.constants";
import { NATURAL_LIFT_PX, NATURAL_MOMENT_MS, NATURAL_SWEEP_PEAK } from "../blackjackMotion";

const HIDDEN = { includeHiddenElements: true };

// A still clock: the moment is timed from `since` on the JS clock.
beforeEach(() => {
  jest.useFakeTimers({ now: 1_700_000_000_000 });
});
afterEach(() => {
  jest.useRealTimers();
});
const flat = (testID: string) =>
  StyleSheet.flatten(screen.getByTestId(testID, HIDDEN).props.style) as Record<string, unknown>;

describe("the moment's timing (owner decision, #3739)", () => {
  it("the lift: up 7 px in 160 ms, held 520 ms, down in 240 ms", () => {
    expect(liftAt(0)).toBe(0);
    expect(liftAt(80)).toBeGreaterThan(NATURAL_LIFT_PX / 2); // ease-out: most of the way at half
    expect(liftAt(160)).toBe(NATURAL_LIFT_PX);
    expect(liftAt(400)).toBe(NATURAL_LIFT_PX);
    expect(liftAt(679)).toBe(NATURAL_LIFT_PX);
    expect(liftAt(800)).toBeCloseTo(NATURAL_LIFT_PX / 2, 5);
    expect(liftAt(920)).toBe(0);
    expect(NATURAL_MOMENT_MS).toBe(920);
  });

  it("the gold edge fades in over 120 ms and stays", () => {
    expect(edgeAt(0)).toBe(0);
    expect(edgeAt(60)).toBeCloseTo(0.5, 5);
    expect(edgeAt(120)).toBe(1);
    expect(edgeAt(NATURAL_MOMENT_MS)).toBe(1);
  });

  it("the sheen crosses once, over 380 ms from +60 ms; the sweep over 560 ms from +60 ms", () => {
    expect(glintAt(60)).toBe(0);
    expect(glintAt(250)).toBeCloseTo(0.5, 5);
    expect(glintAt(440)).toBe(1);
    expect(glintAt(NATURAL_MOMENT_MS)).toBe(1);
    expect(sweepAt(60)).toBe(0);
    expect(sweepAt(340)).toBeCloseTo(0.5, 5);
    expect(sweepAt(620)).toBe(1);
  });

  it("the time into the moment: from its start, its end when none is playing", () => {
    expect(momentElapsed(1000, 1000)).toBe(0);
    expect(momentElapsed(1000, 1300)).toBe(300);
    expect(momentElapsed(1000, 5000)).toBe(NATURAL_MOMENT_MS);
    expect(momentElapsed(null, 1000)).toBe(NATURAL_MOMENT_MS);
  });
});

describe("NaturalEdge", () => {
  const mount = (tone: "gold" | "silver", since: number | null) =>
    render(<NaturalEdge tone={tone} since={since} width={50} height={70} testID="c" />);

  it("static gold: a 2 px edge with its glow, no sheen", async () => {
    await mount("gold", null);
    const s = flat("c-natural-gold");
    expect(s.borderColor).toBe(BLACKJACK_NATURAL_GOLD);
    expect(s.borderWidth).toBe(2);
    expect(s.boxShadow).toBe(`0 0 8px ${BLACKJACK_NATURAL_GOLD}`);
    expect(s.opacity ?? 1).toBe(1);
    expect(screen.queryByTestId("c-natural-sheen", HIDDEN)).toBeNull();
    expect(screen.getByTestId("c-natural-gold", HIDDEN).props.pointerEvents).toBe("none");
  });

  it("the dealer's silver is static, even during a moment", async () => {
    await mount("silver", Date.now());
    expect(flat("c-natural-silver").borderColor).toBe(BLACKJACK_NATURAL_SILVER);
    expect(screen.queryByTestId("c-natural-sheen", HIDDEN)).toBeNull();
  });

  it("the moment's first frame: the edge not yet faded in, the sheen not yet showing (no pop)", async () => {
    await mount("gold", Date.now());
    expect(flat("c-natural-gold").opacity).toBe(0);
    expect(flat("c-natural-sheen").opacity).toBe(0);
  });

  it("mounted mid-moment, it picks the moment up where it is (no restart)", async () => {
    await mount("gold", Date.now() - 250);
    expect(flat("c-natural-gold").opacity).toBe(1);
    expect(flat("c-natural-sheen").opacity).toBe(1);
  });
});

describe("NaturalSweep", () => {
  it("never takes a touch, and starts unseen", async () => {
    await render(<NaturalSweep since={Date.now()} feltWidth={360} feltHeight={500} />);
    expect(screen.getByTestId("natural-sweep", HIDDEN).props.pointerEvents).toBe("none");
    expect(flat("natural-sweep-band").opacity).toBe(0);
  });

  it("peaks at about 0.14 midway", async () => {
    await render(<NaturalSweep since={Date.now() - 340} feltWidth={360} feltHeight={500} />);
    expect(flat("natural-sweep-band").opacity).toBeCloseTo(NATURAL_SWEEP_PEAK, 5);
  });
});

describe('the "Blackjack! 3:2" banner', () => {
  it("the felt's banner says what a natural pays", async () => {
    await render(
      <ThemeProvider>
        <ResultBanner variant="felt" outcome="blackjack" payout={38} />
      </ThemeProvider>
    );
    expect(screen.getByTestId("result-outcome").props.children).toBe("Blackjack! 3:2");
    expect(screen.getByText("+38 chips")).toBeTruthy();
  });

  it("every locale has it, with the 3:2", () => {
    const dir = join(__dirname, "../../../i18n/locales");
    const locales = readdirSync(dir).filter((d) => !d.startsWith("_") && !d.includes("."));
    expect(locales.length).toBeGreaterThanOrEqual(13);
    for (const locale of locales) {
      const strings = JSON.parse(readFileSync(join(dir, locale, "blackjack.json"), "utf8"));
      expect(strings["outcome.blackjackNatural"]).toEqual(expect.stringContaining("3:2"));
    }
    const meta = JSON.parse(readFileSync(join(dir, "_meta", "blackjack.meta.json"), "utf8"));
    expect(meta["outcome.blackjackNatural"]).toBeDefined();
  });
});

// The Jest mock's `withTiming` returns its end value at once, so a lift would read 0 whatever the
// code did. Here a timing holds where it starts (its target less its duration is its start), so
// the lift reads as it is mid-moment, and a reset to rest can be told from none (#3621 review).
describe("the lift", () => {
  const reanimated = jest.requireMock<Record<string, unknown>>("react-native-reanimated");
  beforeEach(() => {
    jest
      .spyOn(reanimated, "withTiming" as never)
      .mockImplementation(
        ((to: number, config?: { duration?: number }) => to - (config?.duration ?? 0)) as never
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const liftOf = (testID: string) => {
    const t = (flat(testID).transform ?? []) as Record<string, number>[];
    return Math.abs(t.find((x) => "translateY" in x)?.translateY ?? 0);
  };

  function Probe({ since }: { readonly since: number | null }) {
    return <View testID="probe" style={useNaturalLift(since)} />;
  }

  it("is up mid-moment, and back down at once when the moment lands (since → null)", async () => {
    const view = await render(<Probe since={Date.now() - 400} />);
    expect(liftOf("probe")).toBe(NATURAL_LIFT_PX);
    // Its effect set the timing going from where the moment is: still up on the next frame.
    await view.rerender(<Probe since={Date.now() - 400} />);
    expect(liftOf("probe")).toBe(NATURAL_LIFT_PX);
    // A tap, Reduce Motion or leaving: the moment lands. The card must come down, not stay up.
    await view.rerender(<Probe since={null} />);
    await view.rerender(<Probe since={null} />);
    expect(liftOf("probe")).toBe(0);
  });

  it("a new moment starts from rest", async () => {
    const view = await render(<Probe since={null} />);
    expect(liftOf("probe")).toBe(0);
    await view.rerender(<Probe since={Date.now()} />);
    await view.rerender(<Probe since={Date.now()} />);
    expect(liftOf("probe")).toBe(0);
  });

  const fan = { x: 10, y: 100, cardWidth: 50, cardHeight: 70, step: 17, count: 2, width: 67 };
  const ACE: CardResponse = { rank: "A", suit: "♠", face_down: false };
  const KING: CardResponse = { rank: "K", suit: "♥", face_down: false };
  const motion: CardMotion = { dealing: new Set(), flipping: new Set(), slideMs: 240, epoch: 0 };
  const felt = (moment: number | null, id = "hand-0", epoch = 0) => (
    <ThemeProvider>
      <FeltCards
        hands={[{ id, cards: [ACE, KING], ids: ["a", "k"], fan, natural: "gold", moment }]}
        motion={{ ...motion, epoch }}
        origin={{ x: 400, y: -140 }}
      />
    </ThemeProvider>
  );

  it("lifts a natural's two cards on the felt, and puts them down when it lands", async () => {
    const view = await render(felt(Date.now() - 400));
    expect(liftOf("hand-0-card-0")).toBe(NATURAL_LIFT_PX);
    expect(liftOf("hand-0-card-1")).toBe(NATURAL_LIFT_PX);
    await view.rerender(felt(null));
    // FeltCard is memoised: a new epoch (a landing) renders it again, reading the shared value.
    await view.rerender(felt(null, "hand-0", 1));
    expect(liftOf("hand-0-card-0")).toBe(0);
    expect(liftOf("hand-0-card-1")).toBe(0);
  });

  it("only a player's cards can lift: the dealer's are plain views", async () => {
    await render(felt(Date.now() - 400, "dealer"));
    expect(liftOf("dealer-card-0")).toBe(0);
  });
});

describe("the light theme", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws the edges and the sweep in the light theme's colours", async () => {
    jest.spyOn(ThemeModule, "useTheme").mockReturnValue({
      theme: "light",
      themeMode: "light",
      colors: light,
      toggle: () => undefined,
      setThemeMode: () => undefined,
    });
    await render(<NaturalEdge tone="gold" since={null} width={50} height={70} testID="g" />);
    expect(flat("g-natural-gold").borderColor).toBe(naturalColors("light").gold);
    await render(<NaturalEdge tone="silver" since={null} width={50} height={70} testID="s" />);
    expect(flat("s-natural-silver").borderColor).toBe(naturalColors("light").silver);
    await render(<NaturalSweep since={Date.now()} feltWidth={360} feltHeight={500} />);
    const bands = screen.getByTestId("natural-sweep-band", HIDDEN).children;
    const colours = bands.map((c) =>
      typeof c === "string"
        ? null
        : (StyleSheet.flatten(c.props.style) as { backgroundColor?: string }).backgroundColor
    );
    expect(colours).toContain(naturalColors("light").sweep);
  });
});

describe("the banner's spoken label", () => {
  it('a natural is read as "Blackjack, pays 3 to 2", not "3 colon 2"', async () => {
    await render(
      <ThemeProvider>
        <ResultBanner variant="felt" outcome="blackjack" payout={38} />
      </ThemeProvider>
    );
    expect(screen.getByTestId("result-outcome").props.accessibilityLabel).toBe(
      "Blackjack, pays 3 to 2"
    );
  });

  it("every locale has it, in words", () => {
    const dir = join(__dirname, "../../../i18n/locales");
    const locales = readdirSync(dir).filter((d) => !d.startsWith("_") && !d.includes("."));
    for (const locale of locales) {
      const strings = JSON.parse(readFileSync(join(dir, locale, "blackjack.json"), "utf8"));
      expect(strings["outcome.blackjackNaturalLabel"]).toEqual(expect.any(String));
      expect(strings["outcome.blackjackNaturalLabel"]).not.toContain(":");
    }
  });
});
