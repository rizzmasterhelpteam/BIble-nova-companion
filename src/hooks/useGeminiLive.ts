import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GoogleGenAI as GoogleGenAIType,
  LiveConnectConfig,
} from "@google/genai";
import { apiFetch } from "../lib/apiClient";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { nativeRecoveryStorage, nativeStorage } from "../lib/native/storage";
import {
  createIdempotentAsyncAction,
  createInitialHistoryPayload,
  createVoiceTurnDetectionState,
  getPcm16PeakAmplitude,
  getPcm16RmsAmplitude,
  getLiveReconnectDelay,
  getLiveSessionDeadlineMs,
  getSafePlaybackGain,
  guardLiveTokenTiming,
  mergeLiveTranscript,
  nextPlaybackGeneration,
  shouldReconnectLiveSession,
  shouldResumeListeningAfterPlayback,
  signalAudioStreamEnd,
  toPcmByteView,
  updateVoiceTurnDetection,
} from "../lib/liveProtocol";
import type { ConversationMessage, VoiceState } from "../types/live";
import {
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_VAD,
  GEMINI_LIVE_VOICE,
} from "../../shared/liveConfig";

type LiveTokenResponse = {
  token?: string;
  model?: string;
  maxMinutes?: number;
  expiresAt?: string;
  reservationHandle?: string;
  reservationExpiresAt?: string;
  remainingSeconds?: number;
  reason?: VoiceErrorCode;
  error?: string;
};

const PENDING_VOICE_RELEASE_KEY = "pending_voice_release_handle";
const PENDING_VOICE_TOKEN_REQUEST_KEY = "pending_voice_token_request_id";

type VoiceErrorCode =
  | "subscription_required"
  | "session_active"
  | "daily_limit"
  | "reservation_invalid"
  | "renewal_unavailable"
  | "eligibility_failed"
  | "connection_failed";

type VoiceEligibilityResponse = {
  eligible?: boolean;
  available?: boolean;
  reason?: "available" | "subscription_required" | "session_active" | "daily_limit" | "reservation_resume";
  retryAfterSeconds?: number | null;
  canRenew?: boolean;
  error?: string;
};

class VoiceStartError extends Error {
  readonly code: VoiceErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: VoiceErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "VoiceStartError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

class VoiceStartCancelledError extends Error {
  constructor() {
    super("Voice start was cancelled.");
    this.name = "VoiceStartCancelledError";
  }
}

type UseGeminiLiveOptions = {
  history: ConversationMessage[];
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  reservation: { handle: string; expiresAt: string } | null;
  onReservationChange: (reservation: { handle: string; expiresAt: string } | null) => void;
  liveReady: boolean;
  apiStatusConnectionError?: string;
};

type GeminiLiveSession = Awaited<ReturnType<GoogleGenAIType["live"]["connect"]>>;
type Gemini31LiveConnectConfig = LiveConnectConfig & {
  historyConfig: {
    initialHistoryInClientContent: true;
  };
};

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const MAX_RECONNECT_ATTEMPTS = 2;
const PLAYBACK_GAIN = getSafePlaybackGain(1.3);
const MIC_WORKLET_BATCH_SIZE = 640;
const MAX_PLAYBACK_QUEUE_SECONDS = 1.1;
const GO_AWAY_SAFETY_MARGIN_MS = 750;
const VOICE_API_TIMEOUT_MS = 12_000;
const VOICE_STORAGE_TIMEOUT_MS = 750;
const VOICE_AUDIO_RESUME_TIMEOUT_MS = 4_000;
const VOICE_LIVE_CONNECT_TIMEOUT_MS = 15_000;
const VOICE_PERMISSION_TIMEOUT_MS = 45_000;
const VOICE_ENTITLEMENT_SYNC_TIMEOUT_MS = 12_000;
const VOICE_AUDIO_FRAME_TIMEOUT_MS = 3_500;
const VOICE_AUDIO_FALLBACK_TIMEOUT_MS = 4_000;
const VOICE_SPEECH_ACTIVITY_NOTICE_MS = 10_000;
const VOICE_NATIVE_BACKGROUND_GRACE_MS = 10_000;
const VOICE_SPEECH_ACTIVITY_PEAK = 0.012;
const VOICE_TURN_SPEECH_START_RMS = 0.009;
const VOICE_TURN_SPEECH_CONTINUATION_RMS = 0.0045;
const VOICE_TURN_MINIMUM_VOICED_MS = 180;
const VOICE_TURN_SILENCE_MS = 1_100;
const MIC_NO_ACTIVITY_NOTICE =
  "I'm connected, but I have not heard speech yet. Speak near the microphone or check your Android microphone route.";
const MIC_NO_FRAMES_NOTICE =
  "Your microphone is allowed, but no audio is reaching Voice. Check microphone access, then end and retry.";
const MIC_ADJUSTING_NOTICE =
  "Adjusting microphone capture for this device. Keep speaking.";

const withVoiceStartupTimeout = <T,>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
) => new Promise<T>((resolve, reject) => {
  let settled = false;
  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new VoiceStartError("connection_failed", message));
  }, timeoutMs);

  promise.then(
    (value) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(value);
    },
    (error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(error);
    },
  );
});

const getGoAwayTimeLeftMs = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const seconds = Number(value.replace(/s$/i, ""));
    return Number.isFinite(seconds) ? seconds * 1_000 : 0;
  }
  if (value && typeof value === "object") {
    const duration = value as { seconds?: number | string; nanos?: number };
    const seconds = Number(duration.seconds || 0);
    const nanos = Number(duration.nanos || 0);
    return Number.isFinite(seconds) && Number.isFinite(nanos)
      ? seconds * 1_000 + nanos / 1_000_000
      : 0;
  }
  return 0;
};

const base64ToBytes = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
};

const floatToPcm16 = (input: Float32Array) => {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index]));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return new Uint8Array(output.buffer);
};

const resample = (input: Float32Array, sourceRate: number, targetRate: number) => {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const lower = Math.floor(sourcePosition);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = sourcePosition - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }

  return output;
};

const decodePcmAudio = (context: AudioContext, base64: string, sampleRate = OUTPUT_SAMPLE_RATE) => {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = Math.floor(bytes.byteLength / 2);
  const buffer = context.createBuffer(1, samples, sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < samples; index += 1) {
    channel[index] = view.getInt16(index * 2, true) / 0x8000;
  }

  return buffer;
};

const getAudioContext = () => {
  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextConstructor) {
    throw new Error("Voice is not supported on this device.");
  }
  // Let the device select its native output rate. Mic input is resampled to
  // 16 kHz separately before it is sent to Gemini.
  return new AudioContextConstructor();
};

export function useGeminiLive({
  history,
  onUserTranscript,
  onAssistantTranscript,
  reservation,
  onReservationChange,
  liveReady,
  apiStatusConnectionError,
}: UseGeminiLiveOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceErrorCode | null>(null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const isMutedRef = useRef(false);

  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | AudioWorkletNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackCompressorRef = useRef<DynamicsCompressorNode | null>(null);
  const playbackSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextPlaybackTimeRef = useRef(0);
  const userTranscriptRef = useRef("");
  const assistantTranscriptRef = useRef("");
  const userTranscriptFinalizedRef = useRef(false);
  const assistantTranscriptFinalizedRef = useRef(false);
  const audioStreamEndedRef = useRef(true);
  const suppressPlaybackRef = useRef(false);
  const playbackGenerationRef = useRef(0);
  const generationCompleteRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const startGenerationRef = useRef(0);
  const startAbortControllerRef = useRef<AbortController | null>(null);
  const audioResumePromiseRef = useRef<Promise<void> | null>(null);
  const isRequestingPermissionRef = useRef(false);
  const permissionPromptGraceUntilRef = useRef(0);
  const startingRef = useRef(false);
  const startRef = useRef<((isReconnect?: boolean) => Promise<void>) | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const audioFrameTimerRef = useRef<number | null>(null);
  const speechActivityTimerRef = useRef<number | null>(null);
  const nativeBackgroundStopTimerRef = useRef<number | null>(null);
  const firstAudioFrameRef = useRef(false);
  const speechActivityDetectedRef = useRef(false);
  const voiceTurnDetectionRef = useRef(createVoiceTurnDetectionState());
  const audioPausedAfterTurnRef = useRef(false);
  const providerMessageReceivedRef = useRef(false);
  const realtimeSendFailedRef = useRef(false);
  const legacyRecoveryMigrationStartedRef = useRef(false);
  const failureHandledRef = useRef(false);
  const sessionResumptionHandleRef = useRef<string | null>(null);
  const reservationHandleRef = useRef<string | null>(reservation?.handle ?? null);
  const reservationExpiresAtRef = useRef<string | null>(reservation?.expiresAt ?? null);
  const pendingReleaseHandleRef = useRef<string | null>(null);
  const tokenRequestIdRef = useRef<string | null>(null);
  const stopActionRef = useRef<ReturnType<typeof createIdempotentAsyncAction> | null>(null);
  const latestStopRef = useRef<((nextState?: VoiceState) => Promise<void>) | null>(null);
  const latestRetryPendingReleaseRef = useRef<(() => Promise<boolean>) | null>(null);
  const latestDiagnosticsRef = useRef<((event: string, details?: Record<string, unknown>) => void) | null>(null);
  if (!stopActionRef.current) stopActionRef.current = createIdempotentAsyncAction();

  const logVoiceDiagnostics = useCallback((event: string, details: Record<string, unknown> = {}) => {
    const payload = {
      event,
      platform: isNativePlatform() ? getNativePlatform() : "web",
      liveReady,
      apiStatusConnectionError: apiStatusConnectionError || null,
      online: typeof navigator === "undefined" ? null : navigator.onLine,
      getUserMediaAvailable: Boolean(typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia),
      ...details,
    };
    console.info("[Bible Nova voice diagnostics]", payload);
    // Capacitor's Android console turns object arguments into "[object Object]".
    // Emit an equivalent primitive log so physical-device traces identify the
    // exact startup boundary without logging tokens or user content.
    if (isNativePlatform()) console.info(`[Bible Nova voice diagnostics] ${JSON.stringify(payload)}`);
  }, [apiStatusConnectionError, liveReady]);

  const runVoiceStartupStep = useCallback(async <T,>(
    stage: string,
    operation: () => Promise<T>,
    timeoutMs = VOICE_API_TIMEOUT_MS,
  ) => {
    logVoiceDiagnostics("startup-stage", { stage, phase: "started" });
    try {
      const value = await withVoiceStartupTimeout(
        operation(),
        timeoutMs,
        `Voice startup timed out while ${stage}. Please try again.`,
      );
      logVoiceDiagnostics("startup-stage", { stage, phase: "completed" });
      return value;
    } catch (error) {
      logVoiceDiagnostics("startup-stage", {
        stage,
        phase: "failed",
        error: error instanceof Error ? error.message : "Unknown startup error.",
      });
      throw error;
    }
  }, [logVoiceDiagnostics]);

  // Capacitor Preferences is only used for crash recovery. A blocked native
  // bridge must not keep a new Voice session from reaching eligibility, nor
  // keep a failed session from releasing its UI state.
  const runNativeVoiceStorageOperation = useCallback(async <T,>(
    stage: string,
    operation: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      const value = await withVoiceStartupTimeout(
        operation(),
        VOICE_STORAGE_TIMEOUT_MS,
        `Voice recovery storage timed out while ${stage}.`,
      );
      logVoiceDiagnostics("native-storage-operation", { stage, phase: "completed" });
      return value;
    } catch (error) {
      logVoiceDiagnostics("native-storage-operation", {
        stage,
        phase: "skipped",
        error: error instanceof Error ? error.message : "Native storage was unavailable.",
      });
      return null;
    }
  }, [logVoiceDiagnostics]);

  const requestNativeVoiceMicrophonePermission = useCallback(async () => {
    if (!isNativePlatform() || getNativePlatform() !== "android") return;

    const { SpeechRecognition } = await runVoiceStartupStep(
      "native-speech-plugin-load",
      () => import("@capgo/capacitor-speech-recognition"),
    );
    const current = await runVoiceStartupStep(
      "native-microphone-permission-check",
      () => SpeechRecognition.checkPermissions(),
    );
    logVoiceDiagnostics("native-microphone-permission", {
      phase: "checked",
      result: current.speechRecognition,
    });
    if (current.speechRecognition === "granted") return;

    isRequestingPermissionRef.current = true;
    try {
      const requested = await runVoiceStartupStep(
        "native-microphone-permission-request",
        () => SpeechRecognition.requestPermissions(),
        VOICE_PERMISSION_TIMEOUT_MS,
      );
      logVoiceDiagnostics("native-microphone-permission", {
        phase: "requested",
        result: requested.speechRecognition,
      });
      if (requested.speechRecognition !== "granted") {
        throw new Error("Microphone access is needed for Voice mode. You can continue in Chat.");
      }
    } finally {
      isRequestingPermissionRef.current = false;
      permissionPromptGraceUntilRef.current = Date.now() + 1_000;
    }
  }, [logVoiceDiagnostics, runVoiceStartupStep]);

  const refreshNativeVoiceEntitlement = useCallback(async () => {
    if (!isNativePlatform() || getNativePlatform() !== "android") return false;

    logVoiceDiagnostics("native-entitlement-recovery", { phase: "started" });
    try {
      const synced = await runVoiceStartupStep(
        "native-entitlement-sync",
        async () => {
          try {
            const { refreshNativeSubscriptionEntitlement } = await import("../lib/native/subscriptionSync");
            return await refreshNativeSubscriptionEntitlement();
          } catch {
            throw new Error("Premium verification could not complete.");
          }
        },
        VOICE_ENTITLEMENT_SYNC_TIMEOUT_MS,
      );
      logVoiceDiagnostics("native-entitlement-recovery", {
        phase: synced ? "succeeded" : "not-found",
      });
      return synced;
    } catch {
      logVoiceDiagnostics("native-entitlement-recovery", { phase: "failed" });
      return false;
    }
  }, [logVoiceDiagnostics, runVoiceStartupStep]);

  const primeAudioForUserGesture = useCallback(() => {
    try {
      const audioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = audioContext;
      if (!audioResumePromiseRef.current) {
        const resumePromise = audioContext.resume();
        audioResumePromiseRef.current = resumePromise;
        void resumePromise.catch((error) => {
          if (audioResumePromiseRef.current === resumePromise) {
            audioResumePromiseRef.current = null;
          }
          logVoiceDiagnostics("audio-context-prime-failed", {
            error: error instanceof Error ? error.message : "Voice audio could not be resumed.",
          });
        });
      }
      logVoiceDiagnostics("audio-context-primed", { state: audioContext.state });
    } catch (audioError) {
      logVoiceDiagnostics("audio-context-prime-failed", {
        error: audioError instanceof Error ? audioError.message : "Voice audio could not be initialized.",
      });
    }
  }, [logVoiceDiagnostics]);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    reservationHandleRef.current = reservation?.handle ?? null;
    reservationExpiresAtRef.current = reservation?.expiresAt ?? null;
  }, [reservation]);

  const persistPendingRelease = useCallback(async (handle: string | null) => {
    if (!isNativePlatform()) return;
    await runNativeVoiceStorageOperation(
      handle ? "pending-release-write" : "pending-release-clear",
      () => handle
        ? nativeRecoveryStorage.set(PENDING_VOICE_RELEASE_KEY, handle)
        : nativeRecoveryStorage.remove(PENDING_VOICE_RELEASE_KEY),
    );
  }, [runNativeVoiceStorageOperation]);

  const persistPendingTokenRequest = useCallback(async (requestId: string | null) => {
    if (!isNativePlatform()) return;
    await runNativeVoiceStorageOperation(
      requestId ? "pending-token-write" : "pending-token-clear",
      () => requestId
        ? nativeRecoveryStorage.set(PENDING_VOICE_TOKEN_REQUEST_KEY, requestId)
        : nativeRecoveryStorage.remove(PENDING_VOICE_TOKEN_REQUEST_KEY),
    );
  }, [runNativeVoiceStorageOperation]);

  const retryPendingRelease = useCallback(async () => {
    const handle = pendingReleaseHandleRef.current;
    if (!handle || (typeof navigator !== "undefined" && !navigator.onLine)) return false;
    try {
      const response = await apiFetch("/api/live/token", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release", reservationHandle: handle }),
      });
      if (!response.ok) return false;
      if (pendingReleaseHandleRef.current === handle) {
        pendingReleaseHandleRef.current = null;
        await persistPendingRelease(null);
      }
      return true;
    } catch {
      return false;
    }
  }, [persistPendingRelease]);

  const clearPendingTokenRequest = useCallback(async () => {
    tokenRequestIdRef.current = null;
    await persistPendingTokenRequest(null);
  }, [persistPendingTokenRequest]);

  const releaseReservation = useCallback(async (handle = reservationHandleRef.current) => {
    reservationHandleRef.current = null;
    reservationExpiresAtRef.current = null;
    onReservationChange(null);
    if (!handle) return;
    pendingReleaseHandleRef.current = handle;
    await persistPendingRelease(handle);
    void retryPendingRelease();
  }, [onReservationChange, persistPendingRelease, retryPendingRelease]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    void Promise.all([
      runNativeVoiceStorageOperation(
        "pending-release-read-on-mount",
        () => nativeRecoveryStorage.get(PENDING_VOICE_RELEASE_KEY),
      ),
      runNativeVoiceStorageOperation(
        "pending-token-read-on-mount",
        () => nativeRecoveryStorage.get(PENDING_VOICE_TOKEN_REQUEST_KEY),
      ),
    ])
      .then(([handle, requestId]) => {
        if (disposed) return;
        // Do not allow a late recovery read to replace the request ID of a
        // Voice start already in progress.
        if (requestId && !tokenRequestIdRef.current && !startingRef.current && !sessionRef.current) {
          tokenRequestIdRef.current = requestId;
        }
        if (handle) {
          pendingReleaseHandleRef.current = handle;
          void retryPendingRelease();
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [retryPendingRelease, runNativeVoiceStorageOperation]);

  useEffect(() => {
    if (!isNativePlatform() || legacyRecoveryMigrationStartedRef.current) return;
    legacyRecoveryMigrationStartedRef.current = true;

    // Older Android builds stored these non-secret recovery identifiers in
    // Capacitor Preferences. Migrate them in the background so a slow bridge
    // cannot delay a new start, while still releasing any lease left by the
    // previous installed bundle.
    void Promise.allSettled([
      nativeStorage.get(PENDING_VOICE_RELEASE_KEY),
      nativeStorage.get(PENDING_VOICE_TOKEN_REQUEST_KEY),
    ]).then(async ([releaseResult, requestResult]) => {
      if (!mountedRef.current) return;
      const handle = releaseResult.status === "fulfilled" ? releaseResult.value : null;
      const requestId = requestResult.status === "fulfilled" ? requestResult.value : null;
      if (handle && !pendingReleaseHandleRef.current) {
        pendingReleaseHandleRef.current = handle;
        await persistPendingRelease(handle);
        void retryPendingRelease();
      }
      if (
        requestId &&
        !tokenRequestIdRef.current &&
        !startingRef.current &&
        !sessionRef.current
      ) {
        tokenRequestIdRef.current = requestId;
        await persistPendingTokenRequest(requestId);
      }
      logVoiceDiagnostics("legacy-native-recovery-migration", {
        releaseHandleFound: Boolean(handle),
        tokenRequestFound: Boolean(requestId),
      });
    }).catch(() => undefined).finally(() => {
      void Promise.allSettled([
        nativeStorage.remove(PENDING_VOICE_RELEASE_KEY),
        nativeStorage.remove(PENDING_VOICE_TOKEN_REQUEST_KEY),
      ]);
    });
  }, [
    logVoiceDiagnostics,
    persistPendingRelease,
    persistPendingTokenRequest,
    retryPendingRelease,
  ]);

  const clearAudioHealthTimers = useCallback(() => {
    if (audioFrameTimerRef.current !== null) window.clearTimeout(audioFrameTimerRef.current);
    if (speechActivityTimerRef.current !== null) window.clearTimeout(speechActivityTimerRef.current);
    audioFrameTimerRef.current = null;
    speechActivityTimerRef.current = null;
  }, []);

  const clearTimers = useCallback(() => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    if (nativeBackgroundStopTimerRef.current !== null) {
      window.clearTimeout(nativeBackgroundStopTimerRef.current);
    }
    noticeTimerRef.current = null;
    endTimerRef.current = null;
    reconnectTimerRef.current = null;
    nativeBackgroundStopTimerRef.current = null;
    clearAudioHealthTimers();
  }, [clearAudioHealthTimers]);

  const stopPlayback = useCallback(() => {
    playbackGenerationRef.current = nextPlaybackGeneration(playbackGenerationRef.current);
    playbackSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      try {
        source.disconnect();
      } catch {
        // The source may already be disconnected by its ended handler.
      }
    });
    playbackSourcesRef.current.clear();
    nextPlaybackTimeRef.current = 0;
  }, []);

  const releaseAudio = useCallback(() => {
    clearAudioHealthTimers();
    voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
    audioPausedAfterTurnRef.current = false;
    const processorNode = processorNodeRef.current;
    if (
      processorNode &&
      typeof AudioWorkletNode !== "undefined" &&
      processorNode instanceof AudioWorkletNode
    ) {
      processorNode.port.onmessage = null;
      processorNode.port.close();
    } else if (processorNode) {
      processorNode.onaudioprocess = null;
    }
    processorNode?.disconnect();
    sourceNodeRef.current?.disconnect();
    muteGainRef.current?.disconnect();
    playbackGainRef.current?.disconnect();
    playbackCompressorRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current = null;
    muteGainRef.current = null;
    playbackGainRef.current = null;
    playbackCompressorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    mediaStreamRef.current = null;
    stopPlayback();

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    audioResumePromiseRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      audioContext.onstatechange = null;
      void audioContext.close().catch(() => undefined);
    }
  }, [clearAudioHealthTimers, stopPlayback]);

  const getPlaybackInput = useCallback((audioContext: AudioContext) => {
    if (playbackGainRef.current && playbackCompressorRef.current) {
      return playbackGainRef.current;
    }

    const playbackGain = audioContext.createGain();
    const compressor = audioContext.createDynamicsCompressor();
    playbackGain.gain.value = PLAYBACK_GAIN;
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;
    playbackGain.connect(compressor);
    compressor.connect(audioContext.destination);
    playbackGainRef.current = playbackGain;
    playbackCompressorRef.current = compressor;
    return playbackGain;
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const finalText = userTranscriptRef.current.trim();
    if (!finalText || userTranscriptFinalizedRef.current) return;
    userTranscriptFinalizedRef.current = true;
    onUserTranscript(finalText);
    userTranscriptRef.current = "";
  }, [onUserTranscript]);

  const finalizeAssistantTranscript = useCallback(() => {
    const finalText = assistantTranscriptRef.current.trim();
    if (!finalText || assistantTranscriptFinalizedRef.current) return;
    assistantTranscriptFinalizedRef.current = true;
    onAssistantTranscript(finalText);
    assistantTranscriptRef.current = "";
  }, [onAssistantTranscript]);

  const playAudioChunk = useCallback(async (data: string, mimeType?: string) => {
    const audioContext = audioContextRef.current;
    if (!audioContext || !data || suppressPlaybackRef.current || stopRequestedRef.current) return;
    if (audioContext.state === "suspended") await audioContext.resume();

    // Do not let bursty provider chunks turn into seconds of stale audio. The
    // current source-node player stays bounded until the output worklet path is
    // available across our Android WebViews.
    if (nextPlaybackTimeRef.current - audioContext.currentTime > MAX_PLAYBACK_QUEUE_SECONDS) {
      return;
    }

    const playbackGeneration = playbackGenerationRef.current;
    const sampleRate = Number(mimeType?.match(/rate=(\d+)/)?.[1] || OUTPUT_SAMPLE_RATE);
    const buffer = decodePcmAudio(audioContext, data, sampleRate);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(getPlaybackInput(audioContext));

    const startAt = Math.max(audioContext.currentTime, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.add(source);
    source.addEventListener("ended", () => {
      try {
        source.disconnect();
      } catch {
        // A stopped source may already be disconnected.
      }
      playbackSourcesRef.current.delete(source);
      if (shouldResumeListeningAfterPlayback({
        playbackGeneration,
        currentGeneration: playbackGenerationRef.current,
        stopRequested: stopRequestedRef.current,
        remainingSources: playbackSourcesRef.current.size,
      }) && generationCompleteRef.current) {
        setState("listening");
      }
    });
    setState("assistant-speaking");
  }, [getPlaybackInput]);

  const stop = useCallback((nextState: VoiceState = "ended") => {
    return stopActionRef.current!(async () => {
      stopRequestedRef.current = true;
      startGenerationRef.current += 1;
      startAbortControllerRef.current?.abort();
      startAbortControllerRef.current = null;
      startingRef.current = false;
      audioStreamEndedRef.current = signalAudioStreamEnd(
        sessionRef.current,
        audioStreamEndedRef.current,
      );
      suppressPlaybackRef.current = false;
      sessionResumptionHandleRef.current = null;
      if (mountedRef.current) setState("ending");
      clearTimers();
      await releaseReservation();
      await clearPendingTokenRequest();
      finalizeUserTranscript();
      finalizeAssistantTranscript();
      releaseAudio();

      const session = sessionRef.current;
      sessionRef.current = null;
      session?.close();
      if (mountedRef.current) setIsMuted(false);
      audioStreamEndedRef.current = true;
      if (mountedRef.current) {
        setSessionNotice(null);
        setState(nextState);
      }
    });
  }, [
    clearTimers,
    finalizeAssistantTranscript,
    finalizeUserTranscript,
    clearPendingTokenRequest,
    releaseAudio,
    releaseReservation,
  ]);

  const handleConnectionFailure = useCallback((
    failedSession: GeminiLiveSession,
    message: string,
  ) => {
    if (stopRequestedRef.current || failureHandledRef.current || sessionRef.current !== failedSession) return;

    logVoiceDiagnostics("gemini-live-connection-failure", { message });

    failureHandledRef.current = true;
    audioStreamEndedRef.current = signalAudioStreamEnd(failedSession, audioStreamEndedRef.current);
    suppressPlaybackRef.current = true;
    releaseAudio();
    sessionRef.current = null;
    try {
      failedSession.close();
    } catch {
      // The transport may already be closed.
    }
    if (shouldReconnectLiveSession(reconnectAttemptsRef.current, MAX_RECONNECT_ATTEMPTS)) {
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;
      setState("reconnecting");
      setError(null);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        failureHandledRef.current = false;
        if (!stopRequestedRef.current && navigator.onLine) {
          void startRef.current?.(true);
        } else if (!stopRequestedRef.current) {
          setState("offline");
          setError("Reconnect to the internet to continue Voice mode.");
        }
      }, getLiveReconnectDelay(attempt));
      return;
    }
    sessionResumptionHandleRef.current = null;
    clearTimers();
    void releaseReservation();
    void clearPendingTokenRequest();
    finalizeUserTranscript();
    finalizeAssistantTranscript();
    setState("error");
    setError(message);
  }, [clearPendingTokenRequest, clearTimers, finalizeAssistantTranscript, finalizeUserTranscript, logVoiceDiagnostics, releaseAudio, releaseReservation]);

  const start = useCallback(async (isReconnect = false) => {
    if (startingRef.current || sessionRef.current) return;
    const startGeneration = startGenerationRef.current + 1;
    const abortController = new AbortController();
    startGenerationRef.current = startGeneration;
    startAbortControllerRef.current?.abort();
    startAbortControllerRef.current = abortController;
    const assertStartIsCurrent = () => {
      if (
        !mountedRef.current ||
        startGenerationRef.current !== startGeneration ||
        abortController.signal.aborted ||
        stopRequestedRef.current
      ) {
        throw new VoiceStartCancelledError();
      }
    };
    startingRef.current = true;
    if (!isReconnect) reconnectAttemptsRef.current = 0;
    if (!isReconnect) sessionResumptionHandleRef.current = null;
    playbackGenerationRef.current += 1;
    audioStreamEndedRef.current = true;
    firstAudioFrameRef.current = false;
    speechActivityDetectedRef.current = false;
    voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
    audioPausedAfterTurnRef.current = false;
    providerMessageReceivedRef.current = false;
    realtimeSendFailedRef.current = false;
    if (!isReconnect) suppressPlaybackRef.current = false;
    stopRequestedRef.current = false;
    failureHandledRef.current = false;
    setError(null);
    setErrorCode(null);
    setRetryAfterSeconds(null);
    setRetryUntil(null);
    setSessionNotice(null);
    logVoiceDiagnostics("start-requested", {
      isReconnect,
      audioContextState: audioContextRef.current?.state || null,
      hasReservation: Boolean(reservationHandleRef.current),
      hasPendingTokenRequest: Boolean(tokenRequestIdRef.current),
    });
    if (!isReconnect) {
      userTranscriptRef.current = "";
      assistantTranscriptRef.current = "";
      userTranscriptFinalizedRef.current = false;
      assistantTranscriptFinalizedRef.current = false;
    }

    if (typeof navigator === "undefined" || !navigator.onLine) {
      clearTimers();
      releaseAudio();
      await releaseReservation();
      await clearPendingTokenRequest();
      setState("offline");
      setError("Reconnect to the internet to start Voice mode.");
      startAbortControllerRef.current = null;
      startingRef.current = false;
      return;
    }

    try {
      const activatedAudioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = activatedAudioContext;
      logVoiceDiagnostics("audio-context-created", { state: activatedAudioContext.state });
      const audioResumePromise = audioResumePromiseRef.current || activatedAudioContext.resume();
      audioResumePromiseRef.current = audioResumePromise;
      assertStartIsCurrent();
      logVoiceDiagnostics("audio-context-resume-pending", { state: activatedAudioContext.state });

      // A stale release must never prevent a new Android Voice start. The
      // eligibility endpoint remains the authority for an active reservation.
      if (!isReconnect) void retryPendingRelease();
      assertStartIsCurrent();
      if (!isReconnect && isNativePlatform() && !tokenRequestIdRef.current) {
        const pendingTokenRequestId = await runNativeVoiceStorageOperation(
          "pending-token-read-before-start",
          () => nativeRecoveryStorage.get(PENDING_VOICE_TOKEN_REQUEST_KEY),
        );
        tokenRequestIdRef.current = pendingTokenRequestId;
        assertStartIsCurrent();
      }
      let recoveredTokenData: LiveTokenResponse | null = null;
      if (!isReconnect && tokenRequestIdRef.current) {
        const recoveryResponse = await runVoiceStartupStep("token-recovery-request", () => apiFetch("/api/live/token", {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Client-Request-Id": tokenRequestIdRef.current,
          },
          body: JSON.stringify({ action: "recover" }),
        }));
        assertStartIsCurrent();
        const recoveryData = (await recoveryResponse.json().catch(() => ({}))) as LiveTokenResponse;
        assertStartIsCurrent();
        logVoiceDiagnostics("token-recovery-response", {
          status: recoveryResponse.status,
          ok: recoveryResponse.ok,
          recoveryHit: Boolean(recoveryResponse.ok && recoveryData.token && recoveryData.model),
          reason: recoveryData.reason || null,
        });
        if (recoveryResponse.ok && recoveryData.token && recoveryData.model) {
          recoveredTokenData = recoveryData;
          if (recoveryData.reservationHandle && recoveryData.reservationExpiresAt) {
            reservationHandleRef.current = recoveryData.reservationHandle;
            reservationExpiresAtRef.current = recoveryData.reservationExpiresAt;
            onReservationChange({
              handle: recoveryData.reservationHandle,
              expiresAt: recoveryData.reservationExpiresAt,
            });
          }
        } else if (recoveryResponse.status === 404 || recoveryResponse.status === 406) {
          await clearPendingTokenRequest();
        } else {
          throw new VoiceStartError(
            recoveryData.reason || "connection_failed",
            recoveryData.error || "Recovering your Voice session. Please try again shortly.",
          );
        }
      }
      setState("requesting-permission");
      const knownExpiry = reservationExpiresAtRef.current
        ? Date.parse(reservationExpiresAtRef.current)
        : Number.NaN;
      if (Number.isFinite(knownExpiry) && knownExpiry <= Date.now()) {
        reservationHandleRef.current = null;
        reservationExpiresAtRef.current = null;
        onReservationChange(null);
      }
      const reservationHandle = reservationHandleRef.current;
      let eligibility: VoiceEligibilityResponse;
      if (recoveredTokenData) {
        eligibility = { available: true, reason: "reservation_resume" };
      } else {
        const requestEligibility = async (stage: string) => {
          const eligibilityResponse = await runVoiceStartupStep(stage, () => apiFetch("/api/live/eligibility", {
            method: "GET",
            signal: abortController.signal,
            headers: reservationHandle
              ? { "X-Voice-Reservation": reservationHandle }
              : undefined,
          }));
          assertStartIsCurrent();
          const nextEligibility = (await eligibilityResponse.json().catch(() => ({}))) as VoiceEligibilityResponse;
          assertStartIsCurrent();
          logVoiceDiagnostics("eligibility-response", {
            stage,
            status: eligibilityResponse.status,
            ok: eligibilityResponse.ok,
            available: nextEligibility.available === true,
            reason: nextEligibility.reason || null,
            retryAfterSeconds: nextEligibility.retryAfterSeconds ?? null,
          });
          if (!eligibilityResponse.ok) {
            throw new VoiceStartError(
              "eligibility_failed",
              nextEligibility.error || "Voice eligibility could not be checked.",
            );
          }
          return nextEligibility;
        };

        eligibility = await requestEligibility("eligibility-request");
        if (
          !isReconnect &&
          eligibility.reason === "subscription_required" &&
          !eligibility.available
        ) {
          const entitlementSynced = await refreshNativeVoiceEntitlement();
          assertStartIsCurrent();
          if (entitlementSynced) {
            eligibility = await requestEligibility("eligibility-retry-after-entitlement-sync");
          }
        }
      }
      if (!eligibility.available) {
        const reason = eligibility.reason === "subscription_required"
          ? "subscription_required"
          : eligibility.reason === "daily_limit"
            ? "daily_limit"
            : "session_active";
        const message = reason === "subscription_required"
          ? "Voice mode requires an active premium subscription."
          : reason === "daily_limit"
            ? "Your daily Voice allowance has been reached."
            : "Another Voice reservation is still active for this account.";
        throw new VoiceStartError(reason, message, eligibility.retryAfterSeconds ?? null);
      }
      if (eligibility.reason !== "reservation_resume") {
        reservationHandleRef.current = null;
        reservationExpiresAtRef.current = null;
        onReservationChange(null);
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        logVoiceDiagnostics("media-unavailable", {
          permissionDenied: false,
          missingMediaDevices: true,
        });
        throw new Error("Voice is not supported on this device.");
      }
      await requestNativeVoiceMicrophonePermission();
      assertStartIsCurrent();
      isRequestingPermissionRef.current = true;
      let stream: MediaStream;
      try {
        const isNativeAndroid = isNativePlatform() && getNativePlatform() === "android";
        const audioConstraints: MediaTrackConstraints = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        };
        logVoiceDiagnostics("microphone-capture-request", {
          nativeAndroid: isNativeAndroid,
          echoCancellation: audioConstraints.echoCancellation,
          noiseSuppression: audioConstraints.noiseSuppression,
          autoGainControl: audioConstraints.autoGainControl,
        });
        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
        });
        const track = stream.getAudioTracks()[0];
        const settings = track?.getSettings();
        logVoiceDiagnostics("microphone-capture-ready", {
          trackCount: stream.getAudioTracks().length,
          trackState: track?.readyState || null,
          trackMuted: track?.muted ?? null,
          trackEnabled: track?.enabled ?? null,
          sampleRate: settings?.sampleRate ?? null,
          channelCount: settings?.channelCount ?? null,
          echoCancellation: settings?.echoCancellation ?? null,
          noiseSuppression: settings?.noiseSuppression ?? null,
          autoGainControl: settings?.autoGainControl ?? null,
        });
      } catch (mediaError) {
        const mediaName = mediaError instanceof DOMException
          ? mediaError.name
          : mediaError instanceof Error
            ? mediaError.name
            : "UnknownError";
        const mediaMessage = mediaError instanceof Error ? mediaError.message : "Microphone access failed.";
        const permissionDenied = /notallowed|permission|denied/i.test(`${mediaName} ${mediaMessage}`);
        logVoiceDiagnostics("microphone-permission-failure", {
          permissionDenied,
          missingMediaDevices: false,
          errorName: mediaName,
          error: mediaMessage,
        });
        throw new Error(
          permissionDenied
            ? "Microphone access is needed for Voice mode. You can continue in Chat."
            : `Microphone could not start: ${mediaMessage}`,
        );
      } finally {
        isRequestingPermissionRef.current = false;
        permissionPromptGraceUntilRef.current = Date.now() + 1_000;
      }
      try {
        assertStartIsCurrent();
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
      mediaStreamRef.current = stream;

      setState("connecting");
      const renewingHandle = eligibility.reason === "reservation_resume"
        ? reservationHandleRef.current
        : null;
      let data = recoveredTokenData;
      if (!data) {
        tokenRequestIdRef.current ||= crypto.randomUUID();
        await persistPendingTokenRequest(tokenRequestIdRef.current);
        assertStartIsCurrent();
        const response = await runVoiceStartupStep(
          "token-request",
          () => apiFetch(
            "/api/live/token",
            renewingHandle
            ? {
                method: "POST",
                signal: abortController.signal,
                headers: {
                  "Content-Type": "application/json",
                  "X-Client-Request-Id": tokenRequestIdRef.current,
                },
                body: JSON.stringify({ reservationHandle: renewingHandle }),
              }
            : {
              method: "POST",
              signal: abortController.signal,
              headers: { "X-Client-Request-Id": tokenRequestIdRef.current },
            },
          ),
        );
        assertStartIsCurrent();
        data = (await response.json().catch(() => ({}))) as LiveTokenResponse;
        assertStartIsCurrent();
        logVoiceDiagnostics("token-response", {
          status: response.status,
          ok: response.ok,
          hasToken: Boolean(data.token),
          model: data.model || null,
          reason: data.reason || null,
          reservationReturned: Boolean(data.reservationHandle),
        });
        if (!response.ok || !data.token || !data.model) {
          if (data.reason === "reservation_invalid" || data.reason === "renewal_unavailable") {
            reservationHandleRef.current = null;
            reservationExpiresAtRef.current = null;
            onReservationChange(null);
          }
          throw new VoiceStartError(
            data.reason || "connection_failed",
            data.error || "Voice is temporarily unavailable. You can continue in Chat.",
          );
        }
      }
      if (!guardLiveTokenTiming(data, releaseAudio)) {
        await releaseReservation(data.reservationHandle || undefined);
        await clearPendingTokenRequest();
        throw new VoiceStartError(
          "renewal_unavailable",
          "This Voice reservation is no longer available.",
        );
      }
      if (data.reservationHandle && data.reservationExpiresAt) {
        reservationHandleRef.current = data.reservationHandle;
        reservationExpiresAtRef.current = data.reservationExpiresAt;
        onReservationChange({
          handle: data.reservationHandle,
          expiresAt: data.reservationExpiresAt,
        });
      }
      if (tokenRequestIdRef.current) {
        const acknowledgedRequestId = tokenRequestIdRef.current;
        const acknowledgement = await runVoiceStartupStep("token-acknowledgement", () => apiFetch("/api/live/token", {
          method: "POST",
          signal: abortController.signal,
          headers: {
            "Content-Type": "application/json",
            "X-Client-Request-Id": acknowledgedRequestId,
          },
          body: JSON.stringify({ action: "acknowledge" }),
        }));
        assertStartIsCurrent();
        if (!acknowledgement.ok) {
          throw new VoiceStartError(
            "connection_failed",
            "Voice startup could not be confirmed. Please try again.",
          );
        }
        if (tokenRequestIdRef.current === acknowledgedRequestId) {
          tokenRequestIdRef.current = null;
          await persistPendingTokenRequest(null);
        }
      }
      await runVoiceStartupStep(
        "audio-context-resume",
        () => audioResumePromise,
        VOICE_AUDIO_RESUME_TIMEOUT_MS,
      );
      assertStartIsCurrent();
      if (activatedAudioContext.state !== "running") {
        throw new Error("Voice audio could not be activated on this device.");
      }
      logVoiceDiagnostics("audio-context-ready", { state: activatedAudioContext.state });
      const { GoogleGenAI, Modality } = await import("@google/genai");
      assertStartIsCurrent();
      const client = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
      });
      const resumingProviderSession = Boolean(sessionResumptionHandleRef.current);
      const liveConfig: Gemini31LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: GEMINI_LIVE_VOICE,
            },
          },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        sessionResumption: {
          handle: sessionResumptionHandleRef.current || undefined,
        },
        historyConfig: {
          initialHistoryInClientContent: true,
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            ...GEMINI_LIVE_VAD,
          },
        },
        abortSignal: abortController.signal,
      };
      let session: GeminiLiveSession | null = null;
      let connectionCallbackError: string | null = null;
      const failConnectedSession = (message: string) => {
        if (session) {
          handleConnectionFailure(session, message);
        } else {
          connectionCallbackError = message;
        }
      };
      session = await runVoiceStartupStep(
        "gemini-live-connect",
        () => client.live.connect({
          model: data.model,
          config: liveConfig,
          callbacks: {
          onopen: () => {
            logVoiceDiagnostics("gemini-live-onopen", { model: data.model });
            if (startGenerationRef.current === startGeneration && !stopRequestedRef.current) {
              setState("ready");
            }
          },
          onmessage: (message) => {
            if (stopRequestedRef.current || startGenerationRef.current !== startGeneration) return;
            if (!providerMessageReceivedRef.current) {
              providerMessageReceivedRef.current = true;
              logVoiceDiagnostics("gemini-live-first-message", {
                hasServerContent: Boolean(message.serverContent),
                hasSetupComplete: Boolean(
                  (message as { setupComplete?: unknown }).setupComplete,
                ),
              });
            }
            const providerMessage = message as {
              sessionResumptionUpdate?: { resumable?: boolean; newHandle?: string };
              goAway?: { timeLeft?: unknown };
            };
            const resumptionUpdate = providerMessage.sessionResumptionUpdate;
            if (resumptionUpdate?.resumable && resumptionUpdate.newHandle) {
              sessionResumptionHandleRef.current = resumptionUpdate.newHandle;
            }
            const goAwayDelay = getGoAwayTimeLeftMs(providerMessage.goAway?.timeLeft);
            if (goAwayDelay > 0 && reconnectTimerRef.current === null) {
              reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                failConnectedSession("The voice connection is refreshing.");
              }, Math.max(0, goAwayDelay - GO_AWAY_SAFETY_MARGIN_MS));
            }
            const serverContent = message.serverContent;
            const inputText = serverContent?.inputTranscription?.text?.trim();
            const outputText = serverContent?.outputTranscription?.text?.trim();

            if (inputText) {
              generationCompleteRef.current = false;
              userTranscriptFinalizedRef.current = false;
              userTranscriptRef.current = mergeLiveTranscript(userTranscriptRef.current, inputText);
              setState("user-speaking");
              if (serverContent?.inputTranscription?.finished) {
                voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
                finalizeUserTranscript();
                setState("thinking");
              }
            }

            if (outputText) {
              assistantTranscriptFinalizedRef.current = false;
              assistantTranscriptRef.current = mergeLiveTranscript(assistantTranscriptRef.current, outputText);
              if (serverContent?.outputTranscription?.finished) finalizeAssistantTranscript();
            }

            if (serverContent?.interrupted) {
              suppressPlaybackRef.current = true;
              stopPlayback();
              setState("interrupted");
            }

            const parts = serverContent?.modelTurn?.parts || [];
            if (parts.length) {
              generationCompleteRef.current = false;
              voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
            }
            for (const part of parts) {
              if (
                part.inlineData?.data &&
                !serverContent?.interrupted &&
                !suppressPlaybackRef.current
              ) {
                void playAudioChunk(part.inlineData.data, part.inlineData.mimeType);
              }
            }

            if (serverContent?.generationComplete) generationCompleteRef.current = true;

            if (serverContent?.turnComplete) {
              reconnectAttemptsRef.current = 0;
              suppressPlaybackRef.current = false;
              voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
              finalizeUserTranscript();
              finalizeAssistantTranscript();
              if (generationCompleteRef.current && playbackSourcesRef.current.size === 0) {
                setState("listening");
              }
            }
          },
          onerror: (event) => {
            const details = event as { name?: string; message?: string };
            logVoiceDiagnostics("gemini-live-onerror", {
              name: details?.name || "LiveConnectionError",
              error: details?.message || "No provider message was supplied.",
              model: data.model,
            });
            console.warn("Gemini Live connection error", {
              name: details?.name || "LiveConnectionError",
              message: details?.message || "No provider message was supplied.",
              apiVersion: GEMINI_LIVE_API_VERSION,
              model: data.model,
            });
            failConnectedSession(
              details?.message
                ? `Voice connection failed: ${details.message}`
                : "Voice is temporarily unavailable. You can continue in Chat.",
            );
          },
          onclose: (event) => {
            const details = event as { code?: number; reason?: string };
            logVoiceDiagnostics("gemini-live-onclose", {
              code: details?.code ?? null,
              reason: details?.reason || "No close reason was supplied.",
              model: data.model,
            });
            console.warn("Gemini Live connection closed", {
              code: details?.code ?? null,
              reason: details?.reason || "No close reason was supplied.",
              apiVersion: GEMINI_LIVE_API_VERSION,
              model: data.model,
            });
            failConnectedSession(
              details?.reason
                ? `The voice connection ended: ${details.reason}`
                : "The voice connection ended. You can try again or continue in Chat.",
            );
          },
          },
        }),
        VOICE_LIVE_CONNECT_TIMEOUT_MS,
      );
      if (connectionCallbackError) {
        session.close();
        throw new VoiceStartError("connection_failed", connectionCallbackError);
      }

      try {
        assertStartIsCurrent();
      } catch (error) {
        session.close();
        throw error;
      }

      const connectedSession = session;
      sessionRef.current = connectedSession;
      // Callbacks from the failed connection are fenced by startGeneration.
      // The newly connected session must not inherit its local audio suppression.
      suppressPlaybackRef.current = false;
      const initialHistory = createInitialHistoryPayload(history);
      if (initialHistory && !resumingProviderSession) {
        connectedSession.sendClientContent(initialHistory);
      }

      const audioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state !== "running") {
        const resumed = audioContext.resume();
        audioResumePromiseRef.current = resumed;
        await runVoiceStartupStep(
          "audio-context-connect-resume",
          () => resumed,
          VOICE_AUDIO_RESUME_TIMEOUT_MS,
        );
      }
      assertStartIsCurrent();
      logVoiceDiagnostics("audio-context-connected", { state: audioContext.state });
      const source = audioContext.createMediaStreamSource(stream);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      const sendPcmAudio = (
        pcm: Uint8Array,
        processorMode: "audio-worklet" | "script-processor",
      ) => {
        if (stopRequestedRef.current) return;
        const rms = getPcm16RmsAmplitude(pcm);
        const shouldMeasurePeak =
          !firstAudioFrameRef.current || !speechActivityDetectedRef.current;
        const peak = shouldMeasurePeak ? getPcm16PeakAmplitude(pcm) : 0;
        if (!firstAudioFrameRef.current) {
          firstAudioFrameRef.current = true;
          if (audioFrameTimerRef.current !== null) {
            window.clearTimeout(audioFrameTimerRef.current);
            audioFrameTimerRef.current = null;
          }
          logVoiceDiagnostics("audio-input-first-frame", {
            mode: processorMode,
            byteLength: pcm.byteLength,
            peak: Number(peak.toFixed(4)),
          });
          setSessionNotice((current) =>
            current === MIC_ADJUSTING_NOTICE ? null : current,
          );
        }
        if (isMutedRef.current) return;
        const previousTurnDetection = voiceTurnDetectionRef.current;
        const turnDetection = updateVoiceTurnDetection({
          state: previousTurnDetection,
          rms,
          frameDurationMs: (pcm.byteLength / 2 / INPUT_SAMPLE_RATE) * 1_000,
          nowMs: performance.now(),
          speechStartRms: VOICE_TURN_SPEECH_START_RMS,
          speechContinuationRms: VOICE_TURN_SPEECH_CONTINUATION_RMS,
          minimumVoicedDurationMs: VOICE_TURN_MINIMUM_VOICED_MS,
          silenceDurationMs: VOICE_TURN_SILENCE_MS,
        });
        voiceTurnDetectionRef.current = turnDetection.state;
        if (turnDetection.speechStarted) {
          audioPausedAfterTurnRef.current = false;
          setState((current) =>
            current === "ending" || current === "reconnecting"
              ? current
              : "user-speaking",
          );
          logVoiceDiagnostics("audio-input-turn-started", {
            mode: processorMode,
            rms: Number(rms.toFixed(4)),
          });
        }
        if (
          !speechActivityDetectedRef.current &&
          peak >= VOICE_SPEECH_ACTIVITY_PEAK
        ) {
          speechActivityDetectedRef.current = true;
          if (speechActivityTimerRef.current !== null) {
            window.clearTimeout(speechActivityTimerRef.current);
            speechActivityTimerRef.current = null;
          }
          setSessionNotice((current) =>
            current === MIC_NO_ACTIVITY_NOTICE ||
            current === MIC_NO_FRAMES_NOTICE ||
            current === MIC_ADJUSTING_NOTICE
              ? null
              : current,
          );
          logVoiceDiagnostics("audio-input-activity-detected", {
            mode: processorMode,
            peak: Number(peak.toFixed(4)),
          });
        }
        if (turnDetection.shouldFlush) {
          const ended = signalAudioStreamEnd(
            connectedSession,
            audioStreamEndedRef.current,
          );
          audioStreamEndedRef.current = ended;
          if (ended) {
            audioPausedAfterTurnRef.current = true;
            setState((current) =>
              current === "assistant-speaking" || current === "ending"
                ? current
                : "thinking",
            );
            logVoiceDiagnostics("audio-input-turn-flushed", {
              mode: processorMode,
              silenceMs: Math.round(turnDetection.silenceMs),
              voicedDurationMs: Math.round(previousTurnDetection.voicedDurationMs),
            });
            return;
          }
          voiceTurnDetectionRef.current = previousTurnDetection;
        }
        if (audioPausedAfterTurnRef.current && !turnDetection.speechStarted) return;
        audioStreamEndedRef.current = false;
        const data = bytesToBase64(pcm);
        try {
          connectedSession.sendRealtimeInput({
            audio: { data, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
          });
        } catch (sendError) {
          if (realtimeSendFailedRef.current) return;
          realtimeSendFailedRef.current = true;
          const message = sendError instanceof Error
            ? sendError.message
            : "The live audio transport rejected microphone input.";
          logVoiceDiagnostics("audio-input-send-failed", {
            mode: processorMode,
            error: message,
          });
          window.setTimeout(() => {
            handleConnectionFailure(
              connectedSession,
              "Microphone audio could not reach Voice. End the session and try again.",
            );
          }, 0);
        }
      };

      let processor: ScriptProcessorNode | AudioWorkletNode | null = null;
      let processorMode: "audio-worklet" | "script-processor" = "script-processor";
      const audioWorkletAvailable = Boolean(audioContext.audioWorklet && typeof AudioWorkletNode !== "undefined");
      let audioWorkletLoaded = false;
      const createFallbackProcessor = () => {
        const fallbackProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        fallbackProcessor.onaudioprocess = (event) => {
          if (stopRequestedRef.current || isMutedRef.current) return;
          const channel = event.inputBuffer.getChannelData(0);
          const pcm = floatToPcm16(
            resample(channel, event.inputBuffer.sampleRate, INPUT_SAMPLE_RATE),
          );
          sendPcmAudio(pcm, "script-processor");
        };
        return fallbackProcessor;
      };
      if (audioWorkletAvailable) {
        try {
          const workletUrl = new URL(
            "audio/gemini-mic-processor.js",
            document.baseURI,
          ).toString();
          await audioContext.audioWorklet.addModule(workletUrl);
          audioWorkletLoaded = true;
          assertStartIsCurrent();
          const worklet = new AudioWorkletNode(audioContext, "gemini-mic-processor", {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: {
              targetSampleRate: INPUT_SAMPLE_RATE,
              batchSize: MIC_WORKLET_BATCH_SIZE,
            },
          });
          worklet.port.onmessage = (event: MessageEvent<unknown>) => {
            if (sessionRef.current !== connectedSession) return;
            const pcm = toPcmByteView(event.data);
            if (!pcm) {
              logVoiceDiagnostics("audio-worklet-invalid-frame", {
                payloadType: typeof event.data,
              });
              return;
            }
            sendPcmAudio(pcm, "audio-worklet");
          };
          processor = worklet;
          processorMode = "audio-worklet";
        } catch (workletError) {
          console.warn("AudioWorklet unavailable; using legacy microphone processing.", workletError);
          logVoiceDiagnostics("audio-worklet-fallback", {
            error: workletError instanceof Error ? workletError.message : String(workletError),
          });
        }
      }

      if (!processor) {
        processor = createFallbackProcessor();
      }
      logVoiceDiagnostics("audio-input-processor", {
        mode: processorMode,
        audioWorkletAvailable,
        audioWorkletLoaded,
        scriptProcessorFallback: processorMode === "script-processor",
      });

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;
      muteGainRef.current = muteGain;

      const scheduleAudioFrameWatchdog = (allowWorkletFallback: boolean) => {
        if (audioFrameTimerRef.current !== null) {
          window.clearTimeout(audioFrameTimerRef.current);
        }
        audioFrameTimerRef.current = window.setTimeout(() => {
          audioFrameTimerRef.current = null;
          if (
            firstAudioFrameRef.current ||
            stopRequestedRef.current ||
            sessionRef.current !== connectedSession
          ) return;
          if (audioContext.state !== "running") {
            logVoiceDiagnostics("audio-input-watchdog", {
              phase: "waiting-for-audio-context",
              mode: processorMode,
              audioContextState: audioContext.state,
            });
            scheduleAudioFrameWatchdog(allowWorkletFallback);
            return;
          }

          const currentProcessor = processorNodeRef.current;
          const canUseScriptProcessor =
            allowWorkletFallback &&
            processorMode === "audio-worklet" &&
            currentProcessor &&
            typeof AudioWorkletNode !== "undefined" &&
            currentProcessor instanceof AudioWorkletNode;
          if (canUseScriptProcessor) {
            logVoiceDiagnostics("audio-input-watchdog", {
              phase: "switching-to-script-processor",
              audioContextState: audioContext.state,
            });
            currentProcessor.port.onmessage = null;
            currentProcessor.port.close();
            currentProcessor.disconnect();
            source.disconnect();
            const fallbackProcessor = createFallbackProcessor();
            source.connect(fallbackProcessor);
            fallbackProcessor.connect(muteGain);
            processorNodeRef.current = fallbackProcessor;
            processorMode = "script-processor";
            setSessionNotice(MIC_ADJUSTING_NOTICE);
            scheduleAudioFrameWatchdog(false);
            return;
          }

          if (speechActivityTimerRef.current !== null) {
            window.clearTimeout(speechActivityTimerRef.current);
            speechActivityTimerRef.current = null;
          }
          logVoiceDiagnostics("audio-input-watchdog", {
            phase: "no-frames",
            mode: processorMode,
            audioContextState: audioContext.state,
          });
          setSessionNotice(MIC_NO_FRAMES_NOTICE);
        }, allowWorkletFallback ? VOICE_AUDIO_FRAME_TIMEOUT_MS : VOICE_AUDIO_FALLBACK_TIMEOUT_MS);
      };
      scheduleAudioFrameWatchdog(processorMode === "audio-worklet");
      speechActivityTimerRef.current = window.setTimeout(() => {
        speechActivityTimerRef.current = null;
        if (
          speechActivityDetectedRef.current ||
          stopRequestedRef.current ||
          sessionRef.current !== connectedSession
        ) return;
        logVoiceDiagnostics("audio-input-watchdog", {
          phase: "no-speech-activity",
          hasAudioFrames: firstAudioFrameRef.current,
          mode: processorMode,
        });
        if (firstAudioFrameRef.current) setSessionNotice(MIC_NO_ACTIVITY_NOTICE);
      }, VOICE_SPEECH_ACTIVITY_NOTICE_MS);

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          handleConnectionFailure(connectedSession, "Your microphone connection ended. Reconnect it and try Voice again.");
        };
        track.onmute = () => {
          if (sessionRef.current === connectedSession && !stopRequestedRef.current) {
            setSessionNotice("Your microphone was muted or interrupted. Check your audio route if Voice does not resume.");
          }
        };
        track.onunmute = () => {
          if (sessionRef.current === connectedSession && !stopRequestedRef.current) {
            setSessionNotice(null);
          }
        };
      });
      audioContext.onstatechange = () => {
        if (audioContext.state === "closed" && sessionRef.current === connectedSession) {
          handleConnectionFailure(connectedSession, "Your audio session was interrupted. Try Voice again.");
        }
      };

      const maxDuration = getLiveSessionDeadlineMs(data);
      if (maxDuration <= 0) {
        throw new VoiceStartError(
          "renewal_unavailable",
          "This Voice reservation is nearly complete.",
        );
      }
      if (maxDuration > 60_000) {
        noticeTimerRef.current = window.setTimeout(() => {
          setSessionNotice("This reflection is nearly complete. We can continue in a new session.");
        }, maxDuration - 60_000);
      }
      endTimerRef.current = window.setTimeout(() => {
        setSessionNotice("This reflection has ended. Start a new session whenever you are ready.");
        void stop("ended");
      }, maxDuration);

      assertStartIsCurrent();
      setState("listening");
    } catch (startError) {
      if (startError instanceof VoiceStartCancelledError || abortController.signal.aborted) {
        logVoiceDiagnostics("start-cancelled", {
          generationCurrent: startGenerationRef.current === startGeneration,
          stopRequested: stopRequestedRef.current,
          hasMediaStream: Boolean(mediaStreamRef.current),
          hasSession: Boolean(sessionRef.current),
        });
        isRequestingPermissionRef.current = false;
        permissionPromptGraceUntilRef.current = 0;
        if (
          mountedRef.current &&
          startGenerationRef.current === startGeneration &&
          !stopRequestedRef.current
        ) {
          clearTimers();
          releaseAudio();
          await releaseReservation();
          await clearPendingTokenRequest();
          setState("idle");
          setSessionNotice("Voice start was interrupted. Tap below to try again.");
        }
        return;
      }
      abortController.abort();
      stopRequestedRef.current = true;
      isRequestingPermissionRef.current = false;
      permissionPromptGraceUntilRef.current = 0;
      clearTimers();
      releaseAudio();
      const failedSession = sessionRef.current;
      sessionRef.current = null;
      sessionResumptionHandleRef.current = null;
      failedSession?.close();
      await releaseReservation();
      await clearPendingTokenRequest();
      const message = startError instanceof Error ? startError.message : "Voice could not start.";
      logVoiceDiagnostics("start-failed", {
        error: message,
        errorType: startError instanceof VoiceStartError ? startError.code : "runtime",
        audioContextState: audioContextRef.current?.state || null,
        hasMediaStream: Boolean(mediaStreamRef.current),
        hasSession: Boolean(failedSession),
      });
      if (startError instanceof VoiceStartError) {
        setState("error");
        setErrorCode(startError.code);
        setRetryAfterSeconds(startError.retryAfterSeconds);
        setRetryUntil(
          startError.retryAfterSeconds
            ? Date.now() + startError.retryAfterSeconds * 1_000
            : null,
        );
        setError(startError.message);
      } else if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed") || message.toLowerCase().includes("microphone access is needed")) {
        setState("permission-denied");
        setError("Microphone access is needed for Voice mode. You can continue in Chat.");
      } else if (!navigator.onLine) {
        setState("offline");
        setError("Reconnect to the internet to start Voice mode.");
      } else {
        setState("error");
        setError(message.includes("continue in Chat") ? message : "Voice is temporarily unavailable. You can continue in Chat.");
      }
    } finally {
      if (startGenerationRef.current === startGeneration) {
        startAbortControllerRef.current = null;
        startingRef.current = false;
      }
    }
  }, [clearPendingTokenRequest, clearTimers, finalizeAssistantTranscript, finalizeUserTranscript, handleConnectionFailure, history, logVoiceDiagnostics, onReservationChange, persistPendingTokenRequest, playAudioChunk, refreshNativeVoiceEntitlement, releaseAudio, releaseReservation, requestNativeVoiceMicrophonePermission, retryPendingRelease, runNativeVoiceStorageOperation, runVoiceStartupStep, stop, stopPlayback]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  useEffect(() => {
    latestStopRef.current = stop;
    latestRetryPendingReleaseRef.current = retryPendingRelease;
    latestDiagnosticsRef.current = logVoiceDiagnostics;
  }, [logVoiceDiagnostics, retryPendingRelease, stop]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const nextMuted = !current;
      isMutedRef.current = nextMuted;
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      if (nextMuted) {
        audioStreamEndedRef.current = signalAudioStreamEnd(
          sessionRef.current,
          audioStreamEndedRef.current,
        );
        audioPausedAfterTurnRef.current = audioStreamEndedRef.current;
        voiceTurnDetectionRef.current = createVoiceTurnDetectionState();
      }
      return nextMuted;
    });
    setState((current) => current === "assistant-speaking" ? current : "listening");
  }, []);

  const interrupt = useCallback(() => {
    suppressPlaybackRef.current = true;
    stopPlayback();
    setState("interrupted");
  }, [stopPlayback]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (isNativePlatform()) return;
      if (isRequestingPermissionRef.current || Date.now() < permissionPromptGraceUntilRef.current) {
        latestDiagnosticsRef.current?.("visibility-ignored-during-permission");
        return;
      }
      if (
        document.visibilityState === "hidden" &&
        (mediaStreamRef.current || sessionRef.current)
      ) {
        void latestStopRef.current?.("ended");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      void retryPendingRelease();
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [retryPendingRelease]);

  useEffect(() => {
    if (!retryUntil) return;
    const remaining = retryUntil - Date.now();
    if (remaining <= 0) {
      setRetryUntil(null);
      setRetryAfterSeconds(null);
      setErrorCode(null);
      setError(null);
      setState("idle");
      return;
    }
    const timer = window.setTimeout(() => {
      setRetryUntil(null);
      setRetryAfterSeconds(null);
      setErrorCode(null);
      setError(null);
      setState("idle");
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [retryUntil]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let listener: { remove: () => Promise<void> } | null = null;
    let disposed = false;
    void import("@capacitor/app")
      .then(({ App }) => App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          if (nativeBackgroundStopTimerRef.current !== null) {
            window.clearTimeout(nativeBackgroundStopTimerRef.current);
            nativeBackgroundStopTimerRef.current = null;
            latestDiagnosticsRef.current?.("app-state-resumed-within-grace");
          }
          const audioContext = audioContextRef.current;
          if (sessionRef.current && audioContext?.state === "suspended") {
            void audioContext.resume().then(
              () => latestDiagnosticsRef.current?.("audio-context-resumed-after-app-resume", {
                state: audioContext.state,
              }),
              (error) => {
                latestDiagnosticsRef.current?.("audio-context-resume-after-app-resume-failed", {
                  error: error instanceof Error ? error.message : "Audio resume failed.",
                });
                setSessionNotice("Android paused the audio session. End Voice and tap retry.");
              },
            );
          }
          void latestRetryPendingReleaseRef.current?.();
          return;
        }
        if (isRequestingPermissionRef.current || Date.now() < permissionPromptGraceUntilRef.current) {
          latestDiagnosticsRef.current?.("app-state-ignored-during-permission");
          return;
        }
        if (
          (mediaStreamRef.current || sessionRef.current) &&
          nativeBackgroundStopTimerRef.current === null
        ) {
          latestDiagnosticsRef.current?.("app-state-background-grace-started", {
            graceMs: VOICE_NATIVE_BACKGROUND_GRACE_MS,
          });
          nativeBackgroundStopTimerRef.current = window.setTimeout(() => {
            nativeBackgroundStopTimerRef.current = null;
            if (mediaStreamRef.current || sessionRef.current) {
              latestDiagnosticsRef.current?.("app-state-background-grace-expired");
              void latestStopRef.current?.("ended");
            }
          }, VOICE_NATIVE_BACKGROUND_GRACE_MS);
        }
      }))
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, []);

  useEffect(() => () => {
    void latestStopRef.current?.("ended");
  }, []);

  return {
    state,
    error,
    errorCode,
    retryAfterSeconds,
    retryUntil,
    isMuted,
    sessionNotice,
    start,
    stop,
    toggleMute,
    primeAudioForUserGesture,
    interrupt,
  };
}
