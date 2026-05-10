import React, { createContext, useContext, useEffect, useState } from "react";

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
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? DEFAULT_HAPTICS_ENABLED : stored === "true";
  } catch {
    return DEFAULT_HAPTICS_ENABLED;
  }
};

export function HapticsProvider({ children }: { children: React.ReactNode }) {
  const [hapticsEnabled, setHapticsEnabledState] = useState(getStoredHapticsPreference);

  const triggerHaptic = (pattern: number | number[] = 10) => {
    if (!hapticsEnabled || !canVibrate()) return;
    navigator.vibrate(pattern);
  };

  const setHapticsEnabled = (enabled: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(enabled));
    } catch {
      // Keep the in-memory setting even if storage is unavailable.
    }

    setHapticsEnabledState(enabled);
    if (enabled && canVibrate()) {
      navigator.vibrate(12);
    }
  };

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

  return (
    <HapticsContext.Provider value={{ hapticsEnabled, setHapticsEnabled, triggerHaptic }}>
      {children}
    </HapticsContext.Provider>
  );
}

export const useHaptics = () => useContext(HapticsContext);
