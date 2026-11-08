import React from "react";
import { render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { CardDeckProvider } from "../decks/CardDeckContext";
import SelectableCard from "../SelectableCard";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <CardDeckProvider>{children}</CardDeckProvider>
    </ThemeProvider>
  );
}

/** The card's animated wrapper style, after the selection effect has run and the card re-rendered. */
async function selectedStyle(reduceMotion: boolean) {
  const card = (label: string) => (
    <Wrapper>
      <SelectableCard
        suit="spades"
        rank={6}
        width={47}
        height={67}
        selected
        reduceMotion={reduceMotion}
        accessibilityLabel={label}
      />
    </Wrapper>
  );
  const { rerender, toJSON } = await render(card("first"));
  // The reanimated mock reads a shared value written in an effect on the next render.
  await rerender(card("second"));
  return JSON.stringify(toJSON());
}

describe("SelectableCard — selection lift (#3606)", () => {
  it("lifts 6 dp with an accent glow", async () => {
    const tree = await selectedStyle(false);
    expect(tree).toContain('"translateY":-6');
    expect(tree).toContain('"shadowOpacity":0.85');
  });

  it("Reduce Motion: no lift or pop, a static glow", async () => {
    const tree = await selectedStyle(true);
    expect(tree).not.toContain('"translateY":-6');
    expect(tree).toContain('"translateY":0');
    expect(tree).toContain('"scale":1}');
    expect(tree).toContain('"shadowOpacity":0.85');
  });

  it("Reduce Motion: an unselected card has no glow", async () => {
    const card = (selected: boolean, label: string) => (
      <Wrapper>
        <SelectableCard
          suit="spades"
          rank={6}
          width={47}
          height={67}
          selected={selected}
          reduceMotion
          accessibilityLabel={label}
        />
      </Wrapper>
    );
    const { rerender, toJSON } = await render(card(true, "a"));
    await rerender(card(false, "b"));
    const tree = JSON.stringify(toJSON());
    // The glow's value is written by the effect and read on the render after it.
    expect(tree).toContain('"shadowOpacity":0.85');
    await rerender(card(false, "c"));
    expect(JSON.stringify(toJSON())).not.toContain('"shadowOpacity":0.85');
  });
});
