import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { FruitSet, FRUIT_SETS, DEFAULT_FRUIT_SET } from "./fruitSets";

const STORAGE_KEY = "gaming_app_fruit_set";

interface FruitSetContextValue {
  activeFruitSet: FruitSet;
  setFruitSetById: (id: string) => void;
}

const DEFAULT_FRUIT_SET_VALUE: FruitSet = FRUIT_SETS[DEFAULT_FRUIT_SET] ?? {
  id: DEFAULT_FRUIT_SET,
  label: "Fruits",
  fruits: [],
};

const FruitSetContext = createContext<FruitSetContextValue>({
  activeFruitSet: DEFAULT_FRUIT_SET_VALUE,
  setFruitSetById: () => {},
});

export function FruitSetProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string>(DEFAULT_FRUIT_SET);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!stored) return;
        // Migrate legacy theme ids
        const migrated = stored === "planets" ? "cosmos" : stored;
        if (FRUIT_SETS[migrated]) {
          setActiveId(migrated);
          if (migrated !== stored) AsyncStorage.setItem(STORAGE_KEY, migrated);
        }
      })
      .catch(() => {});
  }, []);

  // Stable, so callers (the screen's `requestFruitSet`, the memoized ThemeSelector) keep their identity.
  const setFruitSetById = useCallback((id: string) => {
    if (!FRUIT_SETS[id]) return;
    AsyncStorage.setItem(STORAGE_KEY, id);
    setActiveId(id);
  }, []);

  const value = useMemo(
    () => ({ activeFruitSet: FRUIT_SETS[activeId] ?? DEFAULT_FRUIT_SET_VALUE, setFruitSetById }),
    [activeId, setFruitSetById]
  );

  return <FruitSetContext.Provider value={value}>{children}</FruitSetContext.Provider>;
}

export function useFruitSet() {
  return useContext(FruitSetContext);
}
