import { isNativePlatform } from "./native/platform";
import { storageGetJson, storageRemove, storageSet } from "./webStorage";

export type VoiceReservation = {
  handle: string;
  expiresAt: string;
  userId: string;
  status: "active" | "ending";
  recoveryEligible: boolean;
  savedAt: string;
};

export const MIN_RECOVERY_REMAINING_MS = 2 * 60 * 1000;

const KEY_PREFIX = "bible-nova-voice-reservation-";
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`;

const isOwnedUnexpiredReservation = (
  value: VoiceReservation | null,
  userId: string,
  now: number,
) =>
  Boolean(
    value &&
      value.userId === userId &&
      typeof value.handle === "string" &&
      value.handle.length >= 32 &&
      typeof value.expiresAt === "string" &&
      Number.isFinite(Date.parse(value.expiresAt)) &&
      Date.parse(value.expiresAt) > now,
  );

export const isVoiceReservationRecoverable = (
  value: VoiceReservation | null,
  userId: string,
  now = Date.now(),
  minimumRemainingMs = MIN_RECOVERY_REMAINING_MS,
): value is VoiceReservation =>
  Boolean(
    value &&
      value.userId === userId &&
      typeof value.handle === "string" &&
      value.handle.length >= 32 &&
      typeof value.expiresAt === "string" &&
      Number.isFinite(Date.parse(value.expiresAt)) &&
      Date.parse(value.expiresAt) - now >= minimumRemainingMs &&
      value.status === "active" &&
      value.recoveryEligible === true &&
      typeof value.savedAt === "string" &&
      Number.isFinite(Date.parse(value.savedAt)),
  );

export const createVoiceReservation = ({
  handle,
  expiresAt,
  userId,
  now = Date.now(),
}: {
  handle: string;
  expiresAt: string;
  userId: string;
  now?: number;
}): VoiceReservation => ({
  handle,
  expiresAt,
  userId,
  status: "active",
  recoveryEligible: true,
  savedAt: new Date(now).toISOString(),
});

export const markVoiceReservationEnding = (
  reservation: VoiceReservation,
  now = Date.now(),
): VoiceReservation => ({
  ...reservation,
  status: "ending",
  recoveryEligible: false,
  savedAt: new Date(now).toISOString(),
});

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

  if (isVoiceReservationRecoverable(value, userId, now)) return value;
  clearVoiceReservation(userId);
  // Keep an owned, unexpired handle in memory only long enough for the next
  // explicit fresh start to release it. It is removed from persistent storage
  // and can never be treated as recovery intent.
  if (isOwnedUnexpiredReservation(value, userId, now)) {
    return markVoiceReservationEnding(value!, now);
  }
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
