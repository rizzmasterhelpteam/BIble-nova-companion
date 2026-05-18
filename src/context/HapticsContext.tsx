import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { isNativePlatform } from "../lib/native/platform";
import { nativeStorage } from "../lib/native/storage";
import { storageGet, storageSet } from "../lib/webStorage";

type HapticsContextType = {
  hapticsEnabled: boolean;
  setHapticsEnabled: (enabled: boolean) => void;
  triggerHaptic: (pattern?: number | number[]) => void;
};

const STORAGE_KEY = "bible-nova-companion-haptics";
const DEFAULT_HAPTICS_ENABLED = true;

const HapticsContext = createContext<HapticsContextType>({
  hapticsEnabled: DEFAULT_HAPTICS_ENABLED,
  setHapticsEnabled: () => undefined,
  triggerHaptic: () => undefined,
});

const canVibrate = () =>
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

const getStoredHapticsPreference = () => {
  const stored = storageGet(STORAGE_KEY);
  return stored === null ? DEFAULT_HAPTICS_ENABLED : stored === "true";
};

export function HapticsProvider({ children }: { children: React.ReactNode }) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(getStoredHapticsPreference);

  const triggerHaptic = useCallback((pattern: number | number[] = 10) => {
    if (!hapticsEnabled) return;

    if (isNativePlatform()) {
      void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
      return;
    }

    if (canVibrate()) navigator.vibrate(pattern);
  }, [hapticsEnabled]);

  const setHapticsEnabled = useCallback((enabled: boolean) => {
    storageSet(STORAGE_KEY, String(enabled));
    void nativeStorage.set(STORAGE_KEY, String(enabled)).catch(() => undefined);
    setHapticsEnabledState(enabled);
    if (enabled) {
      if (isNativePlatform()) {
        void Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
      } else if (canVibrate()) {
        navigator.vibrate(12);
      }
    }
  }, []);

  useEffect(() => {
    nativeStorage
      .get(STORAGE_KEY)
      .then((stored) => {
        if (stored !== null) {
          setHapticsEnabledState(stored === "true");
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const interactive = target?.closest(
        "button, a, [role='button'], [role='radio'], [role='tab'], [data-haptic]",
      );

      if (!interactive) return;
      if (interactive.closest("button:disabled, [aria-disabled='true'], [data-haptic='off']")) {
        return;
      }

      triggerHaptic(8);
    };

    document.addEventListener("click", handleClick, { capture: true });
    return () => document.removeEventListener("click", handleClick, { capture: true });
  }, [hapticsEnabled]);

  const value = useMemo(
    () => ({ hapticsEnabled, setHapticsEnabled, triggerHaptic }),
    [hapticsEnabled, setHapticsEnabled, triggerHaptic],
  );

  return (
    <HapticsContext.Provider value={value}>
      {children}
    </HapticsContext.Provider>
  );
}

export const useHaptics = () => useContext(HapticsContext);
