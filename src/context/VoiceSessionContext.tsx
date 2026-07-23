import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

type VoiceSessionContextValue = {
  isVoiceSessionActive: boolean;
  setVoiceSessionActive: (active: boolean) => void;
};

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null);

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [isVoiceSessionActive, setVoiceSessionActive] = useState(false);
  const value = useMemo(
    () => ({ isVoiceSessionActive, setVoiceSessionActive }),
    [isVoiceSessionActive],
  );

  return <VoiceSessionContext.Provider value={value}>{children}</VoiceSessionContext.Provider>;
}

export function useVoiceSession() {
  const context = useContext(VoiceSessionContext);
  if (!context) {
    throw new Error("useVoiceSession must be used within VoiceSessionProvider");
  }
  return context;
}
