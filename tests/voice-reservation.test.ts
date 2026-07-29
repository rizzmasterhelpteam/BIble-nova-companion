import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVoiceReservation,
  createVoiceReservation,
  isVoiceReservationRecoverable,
  loadVoiceReservation,
  markVoiceReservationEnding,
  saveVoiceReservation,
} from "../src/lib/voiceReservation";

describe("Voice reservation storage", () => {
  const values = new Map<string, string>();
  const now = Date.parse("2026-07-29T10:00:00.000Z");

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("restores a valid active reservation belonging to the current user", () => {
    const reservation = createVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-29T10:10:00.000Z",
      now,
    });
    saveVoiceReservation(reservation);

    expect(loadVoiceReservation("user-1", now)).toEqual(reservation);
  });

  it("does not recover a reservation with less than two minutes remaining", () => {
    saveVoiceReservation(createVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-29T10:01:59.000Z",
      now,
    }));

    const cleanupReservation = loadVoiceReservation("user-1", now);
    expect(cleanupReservation).toMatchObject({
      handle: "h".repeat(32),
      status: "ending",
      recoveryEligible: false,
    });
    expect(isVoiceReservationRecoverable(cleanupReservation, "user-1", now)).toBe(false);
    expect(values.has("bible-nova-voice-reservation-user-1")).toBe(false);
  });

  it("clears expired, malformed, or wrong-user reservations", () => {
    saveVoiceReservation(createVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-29T10:10:00.000Z",
      now,
    }));
    expect(loadVoiceReservation("user-1", Date.parse("2026-07-29T10:10:01.000Z")))
      .toBeNull();

    values.set(
      "bible-nova-voice-reservation-user-1",
      JSON.stringify({
        ...createVoiceReservation({
          userId: "user-2",
          handle: "h".repeat(32),
          expiresAt: "2026-07-29T10:10:00.000Z",
          now,
        }),
      }),
    );
    expect(loadVoiceReservation("user-1", now)).toBeNull();

    values.set(
      "bible-nova-voice-reservation-user-1",
      JSON.stringify({ userId: "user-1" }),
    );
    expect(loadVoiceReservation("user-1", now)).toBeNull();
  });

  it("does not recover an intentionally ending reservation", () => {
    const active = createVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-29T10:10:00.000Z",
      now,
    });
    saveVoiceReservation(markVoiceReservationEnding(active, now + 1_000));

    const cleanupReservation = loadVoiceReservation("user-1", now + 1_000);
    expect(cleanupReservation?.status).toBe("ending");
    expect(isVoiceReservationRecoverable(cleanupReservation, "user-1", now + 1_000))
      .toBe(false);
    expect(values.has("bible-nova-voice-reservation-user-1")).toBe(false);
  });

  it("clears a reservation explicitly on logout", () => {
    saveVoiceReservation(createVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2099-01-01T00:00:00.000Z",
      now,
    }));
    clearVoiceReservation("user-1");
    expect(loadVoiceReservation("user-1", now)).toBeNull();
  });
});
