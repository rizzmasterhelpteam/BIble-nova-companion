import { isNativePlatform } from "./native/platform";
import { storageGetJson, storageRemove, storageSet } from "./webStorage";

export type VoiceReservation = {
  handle: string;
  expiresAt: string;
  userId: string;
};

const KEY_PREFIX = "bible-nova-voice-reservation-";
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

const isValid = (
  value: VoiceReservation | null,
  userId: string,
  now = Date.now(),
): value is VoiceReservation =>
  Boolean(
    value &&
      value.userId === userId &&
      typeof value.handle === "string" &&
      value.handle.length >= 32 &&
      typeof value.expiresAt === "string" &&
      Number.isFinite(Date.parse(value.expiresAt)) &&
      Date.parse(value.expiresAt) > now,
  );

export const loadVoiceReservation = (
  userId: string,
  now = Date.now(),
): VoiceReservation | null => {
  if (typeof window === "undefined") return null;
  const key = keyFor(userId);
  let value: VoiceReservation | null = null;

  try {
    value = isNativePlatform()
      ? storageGetJson<VoiceReservation | null>(key, null)
      : JSON.parse(window.sessionStorage.getItem(key) || "null") as VoiceReservation | null;
  } catch {
    value = null;
  }

  if (isValid(value, userId, now)) return value;
  clearVoiceReservation(userId);
  return null;
};

export const saveVoiceReservation = (reservation: VoiceReservation) => {
  if (typeof window === "undefined") return;
  try {
    const key = keyFor(reservation.userId);
    const value = JSON.stringify(reservation);
    if (isNativePlatform()) storageSet(key, value);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Voice still works if storage is unavailable; only process recovery is lost.
  }
};

export const clearVoiceReservation = (userId: string) => {
  if (typeof window === "undefined") return;
  try {
    const key = keyFor(userId);
    if (isNativePlatform()) storageRemove(key);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Ignore restricted storage contexts.
  }
};
