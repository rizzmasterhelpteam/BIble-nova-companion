import { describe, expect, it, vi } from "vitest";
import { createCurrentSessionRouter, withOperationTimeout } from "../src/lib/voiceConnectionUtils";

describe("Voice connection utilities", () => {
  it("sends microphone packets to session B after session A is replaced", () => {
    const sessionA = { sendRealtimeInput: vi.fn() };
    const sessionB = { sendRealtimeInput: vi.fn() };
    let current: typeof sessionA | null = sessionA;
    const router = createCurrentSessionRouter(() => current);

    router.send({ audio: "first" });
    current = sessionB;
    router.send({ audio: "second" });

    expect(sessionA.sendRealtimeInput).toHaveBeenCalledTimes(1);
    expect(sessionB.sendRealtimeInput).toHaveBeenCalledWith({ audio: "second" });
  });

  it("does not send packets when no session is connected", () => {
    const router = createCurrentSessionRouter(() => null);
    expect(router.send({ audio: "ignored" })).toBe(false);
  });

  it("fails a hanging operation within its configured timeout", async () => {
    await expect(withOperationTimeout(new Promise<never>(() => undefined), 1, "timed out"))
      .rejects.toThrow("timed out");
  });
});
