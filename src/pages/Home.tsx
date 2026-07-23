import React, { useEffect, useState } from "react";
import Chat from "./Chat";
import { useAuth } from "../context/AuthContext";
import { storageGet, storageSet } from "../lib/webStorage";
import { getHomeModeStorageKey, parseHomeMode } from "../lib/homeMode";
import type { HomeMode } from "../types/live";

const readHomeMode = (identityKey: string | null): HomeMode =>
  parseHomeMode(storageGet(getHomeModeStorageKey(identityKey) || ""));

export default function Home() {
  const { identityKey } = useAuth();
  const [mode, setMode] = useState<HomeMode>("voice");
  const [hasLoadedMode, setHasLoadedMode] = useState(false);

  useEffect(() => {
    setMode(readHomeMode(identityKey));
    setHasLoadedMode(true);
  }, [identityKey]);

  useEffect(() => {
    if (!hasLoadedMode) return;
    const key = getHomeModeStorageKey(identityKey);
    if (key) storageSet(key, mode);
  }, [hasLoadedMode, identityKey, mode]);

  return <Chat mode={mode} onModeChange={setMode} />;
}
