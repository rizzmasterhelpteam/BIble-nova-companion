import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createReleaseOnce,
  VoiceSessionLifecycle,
} from "../src/lib/voiceSessionLifecycle";

describe("Voice session lifecycle guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-29T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires the current session once", async () => {
    const lifecycle = new VoiceSessionLifecycle();
    const releaseOnce = createReleaseOnce();
    const release = vi.fn().mockResolvedValue(undefined);
    const session = lifecycle.begin();

    lifecycle.scheduleExpiry(session, 10, () => {
      lifecycle.invalidate(session);
      void releaseOnce(`session-${session}`, release);
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await releaseOnce(`session-${session}`, release);

    expect(release).toHaveBeenCalledOnce();
    expect(lifecycle.isCurrent(session)).toBe(false);
  });

  it("does not let a stale timer stop a newer session", async () => {
    const lifecycle = new VoiceSessionLifecycle();
    const expireOld = vi.fn();
    const oldSession = lifecycle.begin();
    lifecycle.scheduleExpiry(oldSession, 10, expireOld);

    const newSession = lifecycle.begin();
    const expireNew = vi.fn();
    lifecycle.scheduleExpiry(newSession, 20, expireNew);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(expireOld).not.toHaveBeenCalled();
    expect(expireNew).not.toHaveBeenCalled();
    expect(lifecycle.isCurrent(newSession)).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(expireNew).toHaveBeenCalledWith(newSession);
  });

  it("coalesces repeated cleanup calls into one release request", async () => {
    const releaseOnce = createReleaseOnce();
    const release = vi.fn().mockResolvedValue(undefined);

    await Promise.all([
      releaseOnce("same-handle", release),
      releaseOnce("same-handle", release),
      releaseOnce("same-handle", release),
    ]);

    expect(release).toHaveBeenCalledOnce();
  });

  it("a stale invalidation cannot end a newly started session", () => {
    const lifecycle = new VoiceSessionLifecycle();
    const oldSession = lifecycle.begin();
    const newSession = lifecycle.begin();

    expect(lifecycle.invalidate(oldSession)).toBe(false);
    expect(lifecycle.isCurrent(newSession)).toBe(true);
  });
});
