import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isNativePlatform } from "../lib/native/platform";
import { restoreWebStorageFromPreferences } from "../lib/webStorage";

export type StorageHydrationState = {
  status: "loading" | "ready" | "failed";
};

const AppStorageContext = createContext<StorageHydrationState>({ status: "ready" });

export function AppStorageProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<StorageHydrationState["status"]>(
    isNativePlatform() ? "loading" : "ready",
  );

  useEffect(() => {
    if (!isNativePlatform()) {
      setStatus("ready");
      return;
    }

    let disposed = false;
    void restoreWebStorageFromPreferences()
      .then(() => {
        if (!disposed) setStatus("ready");
      })
      .catch((error) => {
        console.warn("Native Preferences hydration failed:", error);
        if (!disposed) setStatus("failed");
      });

    return () => {
      disposed = true;
    };
  }, []);

  const value = useMemo(() => ({ status }), [status]);
  return <AppStorageContext.Provider value={value}>{children}</AppStorageContext.Provider>;
}

export const useAppStorage = () => useContext(AppStorageContext);
