import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "settings.soundMuted";

interface SoundContextValue {
  muted: boolean;
  setMuted: (muted: boolean) => void;
}

const SoundContext = createContext<SoundContextValue>({
  muted: false,
  setMuted: () => {},
});

export function SoundProvider({ children }: { children: React.ReactNode }) {
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val !== null) setMutedState(val === "true");
    });
  }, []);

  const setMuted = useCallback((value: boolean) => {
    setMutedState(value);
    AsyncStorage.setItem(STORAGE_KEY, String(value));
  }, []);

  const value = useMemo(() => ({ muted, setMuted }), [muted, setMuted]);

  return <SoundContext.Provider value={value}>{children}</SoundContext.Provider>;
}

export function useSoundSettings(): SoundContextValue {
  return useContext(SoundContext);
}
