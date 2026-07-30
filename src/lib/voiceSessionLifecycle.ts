export type VoiceSessionReleaseReason =
  | "user_exit"
  | "user_end"
  | "session_expired"
  | "idle_timeout"
  | "component_unmount"
  | "logout"
  | "subscription_lost"
  | "fatal_error"
  | "stale_recovery";

export type VoiceSessionInteractionReason =
  | "user_pause"
  | "manual_interrupt"
  | "barge_in_interrupt";

export type VoiceLifecycleReason =
  | VoiceSessionReleaseReason
  | VoiceSessionInteractionReason;

type TimerHandle = ReturnType<typeof setTimeout>;

export class VoiceSessionLifecycle {
  private generation = 0;
  private activeGeneration: number | null = null;
  private expiresAtMs = 0;
  private timer: TimerHandle | null = null;
  private timerGeneration: number | null = null;
  private idleTimer: TimerHandle | null = null;
  private idleTimerGeneration: number | null = null;

  begin() {
    this.clearTimer();
    this.clearIdleTimer();
    this.generation += 1;
    this.activeGeneration = this.generation;
    this.expiresAtMs = 0;
    return this.generation;
  }

  isCurrent(generation: number) {
    return this.activeGeneration === generation;
  }

  isExpired(generation: number, now = Date.now()) {
    return this.isCurrent(generation) && this.expiresAtMs > 0 && now >= this.expiresAtMs;
  }

  scheduleExpiry(
    generation: number,
    remainingSeconds: number,
    onExpire: (generation: number) => void,
  ) {
    if (!this.isCurrent(generation) || !Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
      return false;
    }

    this.clearTimer();
    this.expiresAtMs = Date.now() + Math.floor(remainingSeconds * 1_000);
    this.timerGeneration = generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.timerGeneration = null;
      if (!this.isCurrent(generation)) return;
      onExpire(generation);
    }, Math.max(1, Math.floor(remainingSeconds * 1_000)));
    return true;
  }

  scheduleIdleTimeout(
    generation: number,
    idleTimeoutSeconds: number,
    onIdle: (generation: number) => void,
  ) {
    if (
      !this.isCurrent(generation) ||
      !Number.isFinite(idleTimeoutSeconds) ||
      idleTimeoutSeconds <= 0
    ) {
      return false;
    }

    this.clearIdleTimer();
    this.idleTimerGeneration = generation;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.idleTimerGeneration = null;
      if (!this.isCurrent(generation)) return;
      onIdle(generation);
    }, Math.max(1, Math.floor(idleTimeoutSeconds * 1_000)));
    return true;
  }

  invalidate(generation: number) {
    if (!this.isCurrent(generation)) return false;
    this.clearTimer(generation);
    this.clearIdleTimer(generation);
    this.activeGeneration = null;
    this.expiresAtMs = 0;
    return true;
  }

  clearTimer(generation?: number) {
    if (
      generation !== undefined &&
      this.timerGeneration !== null &&
      this.timerGeneration !== generation
    ) {
      return;
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.timerGeneration = null;
  }

  clearIdleTimer(generation?: number) {
    if (
      generation !== undefined &&
      this.idleTimerGeneration !== null &&
      this.idleTimerGeneration !== generation
    ) {
      return;
    }
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.idleTimerGeneration = null;
  }
}

export const createReleaseOnce = () => {
  const requests = new Map<string, Promise<void>>();

  return (key: string, release: () => Promise<void>) => {
    const existing = requests.get(key);
    if (existing) return existing;

    const request = Promise.resolve().then(release);
    requests.set(key, request);
    return request;
  };
};
