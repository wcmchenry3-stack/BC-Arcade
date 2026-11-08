import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AVAILABLE_DECK_IDS, DECK_REGISTRY, DEFAULT_DECK_ID } from "./registry";
import { isDeckSelectable } from "./deckFlag";
import type { DeckTheme } from "./types";
// Minimal deck is eagerly imported — it's the instant fallback while the
// preferred deck loads, and the default in Jest (AsyncStorage returns null).
import MinimalDeck from "./minimal";

const STORAGE_KEY = "card_deck_id";

interface CardDeckContextValue {
  /** Currently active deck. Never null — falls back to Minimal while loading. */
  activeDeck: DeckTheme;
  /** Switch to a different deck. Persists to AsyncStorage. */
  setDeck: (id: string) => void;
  /** IDs of all registered decks. */
  availableDecks: string[];
}

/** The decks this build lists: the flag-gated ones (#3577) only when BC_DECK_ENABLED is on. */
const selectableDecks = () => AVAILABLE_DECK_IDS.filter(isDeckSelectable);

const CardDeckContext = createContext<CardDeckContextValue>({
  activeDeck: MinimalDeck,
  setDeck: () => undefined,
  availableDecks: selectableDecks(),
});

export function CardDeckProvider({ children }: { children: React.ReactNode }) {
  const [activeDeck, setActiveDeck] = useState<DeckTheme>(MinimalDeck);
  const loadingRef = useRef<string | null>(null);

  const loadDeck = useCallback(async (id: string) => {
    const safeId = AVAILABLE_DECK_IDS.includes(id) && isDeckSelectable(id) ? id : DEFAULT_DECK_ID;
    if (loadingRef.current === safeId) return;
    loadingRef.current = safeId;

    // Minimal is already in memory — no async needed.
    if (safeId === "minimal") {
      setActiveDeck(MinimalDeck);
      return;
    }

    try {
      const mod = await DECK_REGISTRY[safeId]!();
      // Only apply if this is still the latest requested deck.
      if (loadingRef.current === safeId) setActiveDeck(mod.default);
    } catch {
      // Deck chunk failed to load — stay on current deck (safe fallback).
      loadingRef.current = null;
    }
  }, []);

  const setDeck = useCallback(
    (id: string) => {
      // A gated deck in a store build resolves to the default; persist what is shown.
      const resolved = isDeckSelectable(id) ? id : DEFAULT_DECK_ID;
      loadDeck(resolved);
      AsyncStorage.setItem(STORAGE_KEY, resolved).catch(() => undefined);
    },
    [loadDeck]
  );

  // Load persisted preference on mount.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => loadDeck(stored ?? DEFAULT_DECK_ID))
      .catch(() => loadDeck(DEFAULT_DECK_ID));
  }, [loadDeck]);

  const availableDecks = useMemo(() => selectableDecks(), []);
  const value = useMemo(
    () => ({ activeDeck, setDeck, availableDecks }),
    [activeDeck, setDeck, availableDecks]
  );

  return <CardDeckContext.Provider value={value}>{children}</CardDeckContext.Provider>;
}

export function useDeck(): CardDeckContextValue {
  return useContext(CardDeckContext);
}
