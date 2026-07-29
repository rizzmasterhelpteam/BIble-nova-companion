import type { ConversationMessage } from "../types/live";

const LIVE_CONTEXT_MESSAGES = 8;
export const MIN_PLAYBACK_GAIN = 1;
export const MAX_PLAYBACK_GAIN = 1.35;

type RealtimeInputSession = {
  sendRealtimeInput: (params: { audioStreamEnd?: boolean }) => void;
};

type LiveTokenTiming = {
  expiresAt?: string;
  reservationExpiresAt?: string;
};

export const isLiveTokenTimingValid = (
  { expiresAt, reservationExpiresAt }: LiveTokenTiming,
  now = Date.now(),
) => {
  const tokenExpiry = typeof expiresAt === "string" ? Date.parse(expiresAt) : Number.NaN;
  const reservationExpiry =
    typeof reservationExpiresAt === "string"
      ? Date.parse(reservationExpiresAt)
      : Number.NaN;
  return (
    Number.isFinite(tokenExpiry) &&
    Number.isFinite(reservationExpiry) &&
    tokenExpiry > now &&
    reservationExpiry > now &&
    tokenExpiry <= reservationExpiry
  );
};

export const guardLiveTokenTiming = (
  timing: LiveTokenTiming,
  onInvalid: () => void,
  now = Date.now(),
) => {
  if (isLiveTokenTimingValid(timing, now)) return true;
  onInvalid();
  return false;
};

export const getLiveSessionDurationMs = ({
  remainingSeconds,
  maxMinutes,
}: {
  remainingSeconds?: number;
  maxMinutes?: number;
}) => {
  const fallbackSeconds = Math.max(60, Math.min(900, Number(maxMinutes || 10) * 60));
  const serverRemainingSeconds = Number(remainingSeconds);
  const effectiveSeconds =
    Number.isFinite(serverRemainingSeconds) && serverRemainingSeconds > 0
      ? Math.max(1, Math.min(900, Math.floor(serverRemainingSeconds)))
      : fallbackSeconds;
  return effectiveSeconds * 1_000;
};

export const getLiveSessionDeadlineMs = (
  { expiresAt, reservationExpiresAt }: LiveTokenTiming,
  now = Date.now(),
  safetyMarginMs = 5_000,
) => {
  const expiryTimes = [expiresAt, reservationExpiresAt]
    .map((value) => (typeof value === "string" ? Date.parse(value) : Number.NaN))
    .filter(Number.isFinite);
  if (!expiryTimes.length) return 0;
  return Math.max(0, Math.min(...expiryTimes) - now - safetyMarginMs);
};

export const mergeLiveTranscript = (current: string, next: string) => {
  const normalizedNext = next.trim().replace(/\s+/g, " ");
  if (!normalizedNext) return current;
  if (!current) return normalizedNext;
  if (normalizedNext.startsWith(current)) return normalizedNext;
  if (current.endsWith(normalizedNext)) return current;

  const currentWords = current.split(" ");
  const nextWords = normalizedNext.split(" ");
  let commonPrefix = 0;
  while (
    commonPrefix < currentWords.length &&
    commonPrefix < nextWords.length &&
    currentWords[commonPrefix].toLowerCase() === nextWords[commonPrefix].toLowerCase()
  ) {
    commonPrefix += 1;
  }
  // Providers sometimes rewrite an in-progress phrase rather than sending a delta.
  if (commonPrefix >= 2 && nextWords.length >= commonPrefix) return normalizedNext;

  const maxOverlap = Math.min(currentWords.length, nextWords.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const suffix = currentWords.slice(-overlap).join(" ").toLowerCase();
    const prefix = nextWords.slice(0, overlap).join(" ").toLowerCase();
    if (suffix === prefix) return `${current} ${nextWords.slice(overlap).join(" ")}`.trim();
  }

  return `${current} ${normalizedNext}`.trim();
};

export const createInitialHistoryPayload = (history: ConversationMessage[]) => {
  const turns = history
    .filter((message) => message.id !== "welcome" && message.tone !== "error")
    .slice(-LIVE_CONTEXT_MESSAGES)
    .map((message) => ({
      role: message.role === "ai" ? "model" : "user",
      parts: [{ text: message.content.slice(0, 2_000) }],
    }));

  if (!turns.length) return null;
  return {
    turns,
    turnComplete: turns.at(-1)?.role === "user",
  };
};

export const signalAudioStreamEnd = (
  session: RealtimeInputSession | null,
  alreadyEnded: boolean,
) => {
  if (!session || alreadyEnded) return alreadyEnded;

  try {
    session.sendRealtimeInput({ audioStreamEnd: true });
    return true;
  } catch {
    return alreadyEnded;
  }
};

export const shouldResumeListeningAfterPlayback = ({
  playbackGeneration,
  currentGeneration,
  stopRequested,
  remainingSources,
}: {
  playbackGeneration: number;
  currentGeneration: number;
  stopRequested: boolean;
  remainingSources: number;
}) =>
  playbackGeneration === currentGeneration &&
  !stopRequested &&
  remainingSources === 0;

export const getSafePlaybackGain = (requestedGain: number) => {
  if (!Number.isFinite(requestedGain)) return MIN_PLAYBACK_GAIN;
  return Math.min(MAX_PLAYBACK_GAIN, Math.max(MIN_PLAYBACK_GAIN, requestedGain));
};

export const nextPlaybackGeneration = (currentGeneration: number) =>
  Math.max(0, Math.floor(currentGeneration)) + 1;

export const toPcmByteView = (value: unknown) => {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (!ArrayBuffer.isView(value)) return null;
  return new Uint8Array(
    value.buffer as ArrayBuffer,
    value.byteOffset,
    value.byteLength,
  );
};

export const getPcm16PeakAmplitude = (pcm: Uint8Array) => {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (!sampleCount) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let peak = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    peak = Math.max(peak, Math.abs(view.getInt16(index * 2, true)) / 0x8000);
  }
  return Math.min(1, peak);
};

export const getPcm16RmsAmplitude = (pcm: Uint8Array) => {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (!sampleCount) return 0;
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let sumOfSquares = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const normalized = view.getInt16(index * 2, true) / 0x8000;
    sumOfSquares += normalized * normalized;
  }
  return Math.min(1, Math.sqrt(sumOfSquares / sampleCount));
};

export type VoiceTurnDetectionState = {
  active: boolean;
  voicedDurationMs: number;
  lastVoiceAtMs: number | null;
};

export const createVoiceTurnDetectionState = (): VoiceTurnDetectionState => ({
  active: false,
  voicedDurationMs: 0,
  lastVoiceAtMs: null,
});

export const updateVoiceTurnDetection = ({
  state,
  rms,
  frameDurationMs,
  nowMs,
  speechStartRms,
  speechContinuationRms,
  minimumVoicedDurationMs,
  silenceDurationMs,
}: {
  state: VoiceTurnDetectionState;
  rms: number;
  frameDurationMs: number;
  nowMs: number;
  speechStartRms: number;
  speechContinuationRms: number;
  minimumVoicedDurationMs: number;
  silenceDurationMs: number;
}) => {
  const normalizedRms = Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0;
  const normalizedFrameDuration = Number.isFinite(frameDurationMs)
    ? Math.max(0, frameDurationMs)
    : 0;
  const voiceThreshold = state.active ? speechContinuationRms : speechStartRms;

  if (normalizedRms >= voiceThreshold) {
    return {
      state: {
        active: true,
        voicedDurationMs: state.voicedDurationMs + normalizedFrameDuration,
        lastVoiceAtMs: nowMs,
      },
      speechStarted: !state.active,
      shouldFlush: false,
      silenceMs: 0,
    };
  }

  if (!state.active || state.lastVoiceAtMs === null) {
    return {
      state,
      speechStarted: false,
      shouldFlush: false,
      silenceMs: 0,
    };
  }

  const silenceMs = Math.max(0, nowMs - state.lastVoiceAtMs);
  if (silenceMs < silenceDurationMs) {
    return {
      state,
      speechStarted: false,
      shouldFlush: false,
      silenceMs,
    };
  }

  return {
    state: createVoiceTurnDetectionState(),
    speechStarted: false,
    shouldFlush: state.voicedDurationMs >= minimumVoicedDurationMs,
    silenceMs,
  };
};

export const createIdempotentAsyncAction = () => {
  let inFlight: Promise<void> | null = null;

  return (action: () => Promise<void>) => {
    if (inFlight) return inFlight;

    const currentAction = action();
    inFlight = currentAction;
    const clear = () => {
      if (inFlight === currentAction) inFlight = null;
    };
    void currentAction.then(clear, clear);
    return currentAction;
  };
};

export const shouldReconnectLiveSession = (
  completedAttempts: number,
  maxAttempts: number,
) => completedAttempts < maxAttempts;

export const getLiveReconnectDelay = (attempt: number) =>
  700 * Math.max(1, attempt);
