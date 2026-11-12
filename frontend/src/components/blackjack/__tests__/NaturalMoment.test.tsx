/**
 * #3621: the natural-blackjack moment's parts (owner decisions, #3739: direction B, "glint +
 * sweep"): the lift, the edge's fade-in, the sheen and the sweep worked out from the time into the
 * moment; the edges drawn static or with the moment; and the "Blackjack! 3:2" banner in every
 * locale.
 */
import React from "react";
import { StyleSheet } from "react-native";
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
} from "../NaturalMoment";
import ResultBanner from "../ResultBanner";
import { ThemeProvider } from "../../../theme/ThemeContext";
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
