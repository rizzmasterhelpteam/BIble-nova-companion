import type { HomeMode } from "../types/live";

export const HOME_MODE_STORAGE_PREFIX = "bible-nova-companion-home-mode-";

export const getHomeModeStorageKey = (identityKey: string | null) =>
  identityKey ? `${HOME_MODE_STORAGE_PREFIX}${identityKey}` : null;

export const parseHomeMode = (value: string | null | undefined): HomeMode =>
  value === "chat" ? "chat" : "voice";
