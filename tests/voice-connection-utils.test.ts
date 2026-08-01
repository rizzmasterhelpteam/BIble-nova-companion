import { describe, expect, it, vi } from "vitest";
import {
  closeLateSession,
  createCurrentSessionRouter,
  withOperationTimeout,
} from "../src/lib/voiceConnectionUtils";

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

  it("closes a late connection after its generation has become stale", () => {
    const session = { close: vi.fn() };
    expect(closeLateSession(session, () => false)).toBe(true);
    expect(session.close).toHaveBeenCalledOnce();
  });

  it("keeps the current connection open", () => {
    const session = { close: vi.fn() };
    expect(closeLateSession(session, () => true)).toBe(false);
    expect(session.close).not.toHaveBeenCalled();
  });
});
