import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearVoiceReservation,
  loadVoiceReservation,
  saveVoiceReservation,
} from "../src/lib/voiceReservation";

describe("Voice reservation storage", () => {
  const values = new Map<string, string>();

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

  it("restores only a live reservation belonging to the current user", () => {
    saveVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-23T12:00:00.000Z",
    });

    expect(loadVoiceReservation("user-1", Date.parse("2026-07-23T11:50:00.000Z"))).toEqual({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    expect(loadVoiceReservation("user-2", Date.parse("2026-07-23T11:50:00.000Z"))).toBeNull();
  });

  it("deletes expired or malformed reservation data", () => {
    saveVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2026-07-23T12:00:00.000Z",
    });
    expect(loadVoiceReservation("user-1", Date.parse("2026-07-23T12:00:01.000Z"))).toBeNull();

    values.set("bible-nova-voice-reservation-user-1", JSON.stringify({ userId: "user-1" }));
    expect(loadVoiceReservation("user-1")).toBeNull();
  });

  it("clears a reservation explicitly on logout", () => {
    saveVoiceReservation({
      userId: "user-1",
      handle: "h".repeat(32),
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    clearVoiceReservation("user-1");
    expect(loadVoiceReservation("user-1")).toBeNull();
  });
});
