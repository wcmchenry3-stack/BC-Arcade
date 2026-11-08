/**
 * #3577: BC_DECK_ENABLED gates Arcade, Parlor and Synthwave — listing and fallback, flag on
 * (Jest runs with __DEV__, an internal build) and off (a forced store build).
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CardDeckProvider, useDeck } from "../CardDeckContext";
import { BC_DECK_ENABLED, BC_DECK_IDS, isBcDeckEnabled, isDeckSelectable } from "../deckFlag";
import { __forceStoreBuildForTests } from "../../buildFlavour";

const mockMk = (id: string) => ({ id, name: id, CardFace: () => null });
const mockDecks: Record<string, ReturnType<typeof mockMk>> = {};
jest.mock("../registry", () => {
  const ids = ["minimal", "classic", "neon", "arcade", "parlor", "synthwave"];
  const reg: Record<string, () => Promise<unknown>> = {};
  for (const id of ids) {
    reg[id] = () => Promise.resolve({ default: (mockDecks[id] ??= mockMk(id)) });
  }
  return { DECK_REGISTRY: reg, DEFAULT_DECK_ID: "classic", AVAILABLE_DECK_IDS: ids };
});

const NEW_DECKS = ["arcade", "parlor", "synthwave"];
const OLD_DECKS = ["minimal", "classic", "neon"];

const mockSeen = jest.fn();
function Probe() {
  mockSeen(useDeck());
  return null;
}
const latestDeck = () => mockSeen.mock.calls.at(-1)![0] as ReturnType<typeof useDeck>;

afterEach(() => {
  __forceStoreBuildForTests(false);
});

describe("BC_DECK_ENABLED", () => {
  it("is on in an internal (dev/test) build", () => {
    expect(BC_DECK_ENABLED).toBe(true);
    expect(isBcDeckEnabled()).toBe(true);
  });

  it("turns off when a store build is forced", () => {
    __forceStoreBuildForTests(true);
    expect(isBcDeckEnabled()).toBe(false);
  });

  it("gates exactly the three new decks", () => {
    expect([...BC_DECK_IDS].sort()).toEqual([...NEW_DECKS].sort());
    __forceStoreBuildForTests(true);
    for (const id of OLD_DECKS) expect(isDeckSelectable(id)).toBe(true);
    for (const id of NEW_DECKS) expect(isDeckSelectable(id)).toBe(false);
  });
});

describe.each(NEW_DECKS)("%s deck behind the flag", (id) => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("flag on: is listed and a saved selection loads", async () => {
    await AsyncStorage.setItem("card_deck_id", id);
    await render(
      <CardDeckProvider>
        <Probe />
      </CardDeckProvider>
    );
    expect(latestDeck().availableDecks).toEqual(expect.arrayContaining([...OLD_DECKS, id]));
    await waitFor(() => expect(latestDeck().activeDeck.id).toBe(id));
  });

  it("flag off: is not listed and a saved selection falls back to the default", async () => {
    __forceStoreBuildForTests(true);
    await AsyncStorage.setItem("card_deck_id", id);
    await render(
      <CardDeckProvider>
        <Probe />
      </CardDeckProvider>
    );
    expect(latestDeck().availableDecks).toEqual(OLD_DECKS);
    expect(latestDeck().availableDecks).not.toContain(id);
    await waitFor(() => expect(latestDeck().activeDeck.id).toBe("classic"));
  });

  it("flag off: setDeck on a gated deck falls back to the default", async () => {
    __forceStoreBuildForTests(true);
    await render(
      <CardDeckProvider>
        <Probe />
      </CardDeckProvider>
    );
    await act(async () => {
      latestDeck().setDeck(id);
    });
    await waitFor(() => expect(latestDeck().activeDeck.id).toBe("classic"));
  });
});
