import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { isNativePlatform } from "../lib/native/platform";
import { getInstalledNativeRuntimeInfo } from "../lib/native/runtime";
import type { NativeRuntimeInfo } from "../platform/types";

export type NativeRuntimeState = {
  status: "loading" | "ready" | "unavailable";
  runtime: NativeRuntimeInfo;
  error: string | null;
};

const unavailableRuntime: NativeRuntimeInfo = {
  platform: "android",
  appVersion: "unknown",
  buildNumber: "unknown",
  bridgeVersion: 0,
};

const webRuntime: NativeRuntimeInfo = {
  platform: "web",
  appVersion: "web",
  buildNumber: "web",
  bridgeVersion: Number.MAX_SAFE_INTEGER,
};

const NativeRuntimeContext = createContext<NativeRuntimeState>({
  status: "ready",
  runtime: webRuntime,
  error: null,
});

export function NativeRuntimeProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<NativeRuntimeState>(() => isNativePlatform()
    ? { status: "loading", runtime: unavailableRuntime, error: null }
    : { status: "ready", runtime: webRuntime, error: null });

  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;

    void getInstalledNativeRuntimeInfo()
      .then((runtime) => {
        if (!disposed) setState({ status: "ready", runtime, error: null });
      })
      .catch((error) => {
        if (!disposed) {
          setState({
            status: "unavailable",
            runtime: unavailableRuntime,
            error: error instanceof Error ? error.message : "Native runtime information is unavailable.",
          });
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  const value = useMemo(() => state, [state]);
  return <NativeRuntimeContext.Provider value={value}>{children}</NativeRuntimeContext.Provider>;
}

export const useNativeRuntime = () => useContext(NativeRuntimeContext);
