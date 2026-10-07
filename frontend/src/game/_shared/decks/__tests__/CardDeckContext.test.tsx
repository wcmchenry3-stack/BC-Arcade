import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import { CardDeckProvider, useDeck } from "../CardDeckContext";
import MinimalDeck from "../minimal";

// Jest cannot run the registry's dynamic imports, so the other decks are
// stand-ins that load as a promise would.
const mockClassicDeck = { id: "classic", name: "Classic", CardFace: () => null };
jest.mock("../registry", () => ({
  DECK_REGISTRY: {
    minimal: () => Promise.resolve({ default: { id: "minimal" } }),
    classic: () => Promise.resolve({ default: mockClassicDeck }),
  },
  DEFAULT_DECK_ID: "classic",
  AVAILABLE_DECK_IDS: ["minimal", "classic"],
}));

const onRender = jest.fn();
const Consumer = React.memo(function Consumer() {
  onRender(useDeck());
  return null;
});
const consumer = <Consumer />;

const lastValue = () => onRender.mock.calls.at(-1)![0] as ReturnType<typeof useDeck>;

describe("CardDeckContext — render stability (#2964)", () => {
  beforeEach(() => {
    onRender.mockClear();
  });

  it("does not re-render consumers when the provider re-renders with the same state", async () => {
    const api = await render(<CardDeckProvider>{consumer}</CardDeckProvider>);
    // The persisted (here: default) deck loads asynchronously.
    await waitFor(() => expect(lastValue().activeDeck).toBe(mockClassicDeck));
    const rendersAfterLoad = onRender.mock.calls.length;
    const first = lastValue();

    await api.rerender(<CardDeckProvider>{consumer}</CardDeckProvider>);
    await api.rerender(<CardDeckProvider>{consumer}</CardDeckProvider>);

    expect(onRender).toHaveBeenCalledTimes(rendersAfterLoad);
    expect(lastValue()).toBe(first);
  });

  it("keeps setDeck's identity, and re-renders once when the deck changes", async () => {
    const api = await render(<CardDeckProvider>{consumer}</CardDeckProvider>);
    await waitFor(() => expect(lastValue().activeDeck).toBe(mockClassicDeck));
    const before = lastValue();
    const rendersBefore = onRender.mock.calls.length;

    await act(async () => {
      before.setDeck("minimal");
    });
    expect(onRender).toHaveBeenCalledTimes(rendersBefore + 1);
    expect(lastValue().activeDeck).toBe(MinimalDeck);
    expect(lastValue().setDeck).toBe(before.setDeck);
    expect(lastValue().availableDecks).toBe(before.availableDecks);

    await api.rerender(<CardDeckProvider>{consumer}</CardDeckProvider>);
    expect(onRender).toHaveBeenCalledTimes(rendersBefore + 1);
  });
});
