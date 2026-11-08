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

  it("flag off: setDeck on a gated deck persists the resolved id, not the gated one", async () => {
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
    expect(await AsyncStorage.getItem("card_deck_id")).toBe("classic");
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

describe("BC_DECK_ENABLED compiled off (IS_INTERNAL_BUILD false)", () => {
  afterEach(() => {
    jest.dontMock("../../buildFlavour");
    jest.dontMock("react");
  });

  /** Loads the flag and the provider against a buildFlavour that says "store build". */
  function loadAsStoreBuild() {
    // Same React as the renderer, so hooks in the isolated provider work.
    const ReactActual = jest.requireActual("react");
    let mods!: {
      flag: typeof import("../deckFlag");
      ctx: typeof import("../CardDeckContext");
      storage: typeof AsyncStorage;
    };
    jest.isolateModules(() => {
      jest.doMock("react", () => ReactActual);
      jest.doMock("../../buildFlavour", () => ({
        IS_INTERNAL_BUILD: false,
        isStoreBuildForced: () => false,
      }));
      mods = {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        flag: require("../deckFlag"),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        ctx: require("../CardDeckContext"),
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        storage: require("@react-native-async-storage/async-storage"),
      };
    });
    return mods;
  }

  it("the flag is off and gates the three new decks only", () => {
    const { flag } = loadAsStoreBuild();
    expect(flag.BC_DECK_ENABLED).toBe(false);
    expect(flag.isBcDeckEnabled()).toBe(false);
    for (const id of NEW_DECKS) expect(flag.isDeckSelectable(id)).toBe(false);
    for (const id of OLD_DECKS) expect(flag.isDeckSelectable(id)).toBe(true);
  });

  it.each(NEW_DECKS)(
    "does not list %s and falls back to classic for a saved selection",
    async (id) => {
      const { ctx, storage } = loadAsStoreBuild();
      await storage.setItem("card_deck_id", id);
      const seen = jest.fn();
      const Spy = () => {
        seen(ctx.useDeck());
        return null;
      };
      await render(
        <ctx.CardDeckProvider>
          <Spy />
        </ctx.CardDeckProvider>
      );
      const last = () => seen.mock.calls.at(-1)![0] as ReturnType<typeof useDeck>;
      expect(last().availableDecks).toEqual(OLD_DECKS);
      await waitFor(() => expect(last().activeDeck.id).toBe("classic"));
    }
  );
});
