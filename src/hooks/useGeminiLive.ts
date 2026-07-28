import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GoogleGenAI as GoogleGenAIType,
  LiveConnectConfig,
} from "@google/genai";
import { apiFetch } from "../lib/apiClient";
import { isNativePlatform } from "../lib/native/platform";
import { nativeStorage } from "../lib/native/storage";
import { refreshNativeSubscriptionEntitlement } from "../lib/native/subscriptionSync";
import {
  createIdempotentAsyncAction,
  createInitialHistoryPayload,
  getLiveReconnectDelay,
  getLiveSessionDeadlineMs,
  getLiveSessionDurationMs,
  getSafePlaybackGain,
  guardLiveTokenTiming,
  mergeLiveTranscript,
  nextPlaybackGeneration,
  shouldReconnectLiveSession,
  shouldResumeListeningAfterPlayback,
  signalAudioStreamEnd,
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
const MAX_RESUMABLE_AUDIO_CHUNKS = 250;

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
  const startingRef = useRef(false);
  const startRef = useRef<((isReconnect?: boolean) => Promise<void>) | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const failureHandledRef = useRef(false);
  const sessionResumptionHandleRef = useRef<string | null>(null);
  const nextClientMessageIndexRef = useRef(0);
  const resumableAudioRef = useRef<Array<{ index: number; data: string }>>([]);
  const reservationHandleRef = useRef<string | null>(reservation?.handle ?? null);
  const reservationExpiresAtRef = useRef<string | null>(reservation?.expiresAt ?? null);
  const pendingReleaseHandleRef = useRef<string | null>(null);
  const tokenRequestIdRef = useRef<string | null>(null);
  const stopActionRef = useRef<ReturnType<typeof createIdempotentAsyncAction> | null>(null);
  if (!stopActionRef.current) stopActionRef.current = createIdempotentAsyncAction();

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
    try {
      if (handle) await nativeStorage.set(PENDING_VOICE_RELEASE_KEY, handle);
      else await nativeStorage.remove(PENDING_VOICE_RELEASE_KEY);
    } catch {
      // A later in-memory retry can still release the current process's lease.
    }
  }, []);

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

  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    void nativeStorage.get(PENDING_VOICE_RELEASE_KEY)
      .then((handle) => {
        if (disposed || !handle) return;
        pendingReleaseHandleRef.current = handle;
        void retryPendingRelease();
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [retryPendingRelease]);

  const clearTimers = useCallback(() => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    noticeTimerRef.current = null;
    endTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

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
    if (audioContext && audioContext.state !== "closed") {
      audioContext.onstatechange = null;
      void audioContext.close().catch(() => undefined);
    }
  }, [stopPlayback]);

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
      const reservationHandle = reservationHandleRef.current;
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
      nextClientMessageIndexRef.current = 0;
      resumableAudioRef.current = [];
      reservationHandleRef.current = null;
      reservationExpiresAtRef.current = null;
      onReservationChange(null);
      if (reservationHandle) {
        pendingReleaseHandleRef.current = reservationHandle;
        void persistPendingRelease(reservationHandle).then(retryPendingRelease);
      }
      if (mountedRef.current) setState("ending");
      clearTimers();
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
    onReservationChange,
    persistPendingRelease,
    releaseAudio,
    retryPendingRelease,
  ]);

  const handleConnectionFailure = useCallback((
    failedSession: GeminiLiveSession,
    message: string,
  ) => {
    if (stopRequestedRef.current || failureHandledRef.current || sessionRef.current !== failedSession) return;

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
    finalizeUserTranscript();
    finalizeAssistantTranscript();
    setState("error");
    setError(message);
  }, [finalizeAssistantTranscript, finalizeUserTranscript, releaseAudio]);

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
    if (!isReconnect) suppressPlaybackRef.current = false;
    stopRequestedRef.current = false;
    failureHandledRef.current = false;
    setError(null);
    setErrorCode(null);
    setRetryAfterSeconds(null);
    setRetryUntil(null);
    setSessionNotice(null);
    if (!isReconnect) {
      nextClientMessageIndexRef.current = 0;
      resumableAudioRef.current = [];
      userTranscriptRef.current = "";
      assistantTranscriptRef.current = "";
      userTranscriptFinalizedRef.current = false;
      assistantTranscriptFinalizedRef.current = false;
    }

    if (typeof navigator === "undefined" || !navigator.onLine) {
      setState("offline");
      setError("Reconnect to the internet to start Voice mode.");
      startingRef.current = false;
      return;
    }

    try {
      if (!isReconnect) await retryPendingRelease();
      assertStartIsCurrent();
      const activatedAudioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = activatedAudioContext;
      await activatedAudioContext.resume();
      assertStartIsCurrent();
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
      if (!isReconnect && isNativePlatform()) {
        void refreshNativeSubscriptionEntitlement().catch((syncError) => {
          console.warn("Native subscription refresh did not complete", {
            message: syncError instanceof Error ? syncError.message : "Unknown subscription refresh error.",
          });
        });
      }
      const eligibilityResponse = await apiFetch("/api/live/eligibility", {
        method: "GET",
        signal: abortController.signal,
        headers: reservationHandle
          ? { "X-Voice-Reservation": reservationHandle }
          : undefined,
      });
      assertStartIsCurrent();
      const eligibility = (await eligibilityResponse.json().catch(() => ({}))) as VoiceEligibilityResponse;
      assertStartIsCurrent();
      if (!eligibilityResponse.ok) {
        throw new VoiceStartError(
          "eligibility_failed",
          eligibility.error || "Voice eligibility could not be checked.",
        );
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
        throw new Error("Voice is not supported on this device.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
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
      tokenRequestIdRef.current ||= crypto.randomUUID();
      const response = await apiFetch(
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
      );
      assertStartIsCurrent();
      const data = (await response.json().catch(() => ({}))) as LiveTokenResponse;
      assertStartIsCurrent();
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
      tokenRequestIdRef.current = null;
      if (!guardLiveTokenTiming(data, releaseAudio)) {
        reservationHandleRef.current = null;
        reservationExpiresAtRef.current = null;
        onReservationChange(null);
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
          transparent: true,
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
      let session: GeminiLiveSession;
      session = await client.live.connect({
        model: data.model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            if (startGenerationRef.current === startGeneration && !stopRequestedRef.current) {
              setState("ready");
            }
          },
          onmessage: (message) => {
            if (stopRequestedRef.current || startGenerationRef.current !== startGeneration) return;
            const providerMessage = message as {
              sessionResumptionUpdate?: {
                resumable?: boolean;
                newHandle?: string;
                lastConsumedClientMessageIndex?: string | number;
              };
              goAway?: { timeLeft?: unknown };
            };
            const resumptionUpdate = providerMessage.sessionResumptionUpdate;
            if (resumptionUpdate?.resumable && resumptionUpdate.newHandle) {
              sessionResumptionHandleRef.current = resumptionUpdate.newHandle;
            }
            const lastConsumed = Number(resumptionUpdate?.lastConsumedClientMessageIndex);
            if (Number.isFinite(lastConsumed)) {
              resumableAudioRef.current = resumableAudioRef.current.filter(
                ({ index }) => index > lastConsumed,
              );
            }
            const goAwayDelay = getGoAwayTimeLeftMs(providerMessage.goAway?.timeLeft);
            if (goAwayDelay > 0 && reconnectTimerRef.current === null) {
              reconnectTimerRef.current = window.setTimeout(() => {
                reconnectTimerRef.current = null;
                handleConnectionFailure(session, "The voice connection is refreshing.");
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
            if (parts.length) generationCompleteRef.current = false;
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
              finalizeUserTranscript();
              finalizeAssistantTranscript();
              if (generationCompleteRef.current && playbackSourcesRef.current.size === 0) {
                setState("listening");
              }
            }
          },
          onerror: (event) => {
            const details = event as { name?: string; message?: string };
            console.warn("Gemini Live connection error", {
              name: details?.name || "LiveConnectionError",
              message: details?.message || "No provider message was supplied.",
              apiVersion: GEMINI_LIVE_API_VERSION,
              model: data.model,
            });
            handleConnectionFailure(
              session,
              details?.message
                ? `Voice connection failed: ${details.message}`
                : "Voice is temporarily unavailable. You can continue in Chat.",
            );
          },
          onclose: (event) => {
            const details = event as { code?: number; reason?: string };
            console.warn("Gemini Live connection closed", {
              code: details?.code ?? null,
              reason: details?.reason || "No close reason was supplied.",
              apiVersion: GEMINI_LIVE_API_VERSION,
              model: data.model,
            });
            handleConnectionFailure(
              session,
              details?.reason
                ? `The voice connection ended: ${details.reason}`
                : "The voice connection ended. You can try again or continue in Chat.",
            );
          },
        },
      });

      try {
        assertStartIsCurrent();
      } catch (error) {
        session.close();
        throw error;
      }

      sessionRef.current = session;
      // Callbacks from the failed connection are fenced by startGeneration.
      // The newly connected session must not inherit its local audio suppression.
      suppressPlaybackRef.current = false;
      const initialHistory = createInitialHistoryPayload(history);
      if (initialHistory && !resumingProviderSession) session.sendClientContent(initialHistory);
      if (resumingProviderSession) {
        resumableAudioRef.current.forEach(({ data: bufferedData }) => {
          session.sendRealtimeInput({
            audio: { data: bufferedData, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
          });
        });
      }

      const audioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state !== "running") await audioContext.resume();
      assertStartIsCurrent();
      const source = audioContext.createMediaStreamSource(stream);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      const sendPcmAudio = (pcm: Uint8Array) => {
        if (stopRequestedRef.current || isMutedRef.current) return;
        audioStreamEndedRef.current = false;
        const data = bytesToBase64(pcm);
        resumableAudioRef.current.push({
          index: nextClientMessageIndexRef.current,
          data,
        });
        nextClientMessageIndexRef.current += 1;
        if (resumableAudioRef.current.length > MAX_RESUMABLE_AUDIO_CHUNKS) {
          resumableAudioRef.current.splice(
            0,
            resumableAudioRef.current.length - MAX_RESUMABLE_AUDIO_CHUNKS,
          );
        }
        session.sendRealtimeInput({
          audio: { data, mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
        });
      };

      let processor: ScriptProcessorNode | AudioWorkletNode | null = null;
      if (audioContext.audioWorklet && typeof AudioWorkletNode !== "undefined") {
        try {
          const workletUrl = new URL(
            "audio/gemini-mic-processor.js",
            document.baseURI,
          ).toString();
          await audioContext.audioWorklet.addModule(workletUrl);
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
          worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
            if (
              sessionRef.current !== session ||
              !(event.data instanceof ArrayBuffer)
            ) {
              return;
            }
            sendPcmAudio(new Uint8Array(event.data));
          };
          processor = worklet;
        } catch (workletError) {
          console.warn("AudioWorklet unavailable; using legacy microphone processing.", workletError);
        }
      }

      if (!processor) {
        const fallbackProcessor = audioContext.createScriptProcessor(4096, 1, 1);
        fallbackProcessor.onaudioprocess = (event) => {
          if (stopRequestedRef.current || isMutedRef.current) return;
          const channel = event.inputBuffer.getChannelData(0);
          const pcm = floatToPcm16(
            resample(channel, event.inputBuffer.sampleRate, INPUT_SAMPLE_RATE),
          );
          sendPcmAudio(pcm);
        };
        processor = fallbackProcessor;
      }

      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;
      muteGainRef.current = muteGain;

      stream.getAudioTracks().forEach((track) => {
        track.onended = () => {
          handleConnectionFailure(session, "Your microphone connection ended. Reconnect it and try Voice again.");
        };
        track.onmute = () => {
          if (sessionRef.current === session && !stopRequestedRef.current) {
            setSessionNotice("Your microphone was muted or interrupted. Check your audio route if Voice does not resume.");
          }
        };
        track.onunmute = () => {
          if (sessionRef.current === session && !stopRequestedRef.current) setSessionNotice(null);
        };
      });
      audioContext.onstatechange = () => {
        if (audioContext.state === "closed" && sessionRef.current === session) {
          handleConnectionFailure(session, "Your audio session was interrupted. Try Voice again.");
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
        return;
      }
      stopRequestedRef.current = true;
      releaseAudio();
      sessionRef.current?.close();
      sessionRef.current = null;
      const message = startError instanceof Error ? startError.message : "Voice could not start.";
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
      } else if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")) {
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
  }, [finalizeAssistantTranscript, finalizeUserTranscript, handleConnectionFailure, history, onReservationChange, playAudioChunk, releaseAudio, retryPendingRelease, stop, stopPlayback]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const nextMuted = !current;
      mediaStreamRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !nextMuted;
      });
      if (nextMuted) {
        audioStreamEndedRef.current = signalAudioStreamEnd(
          sessionRef.current,
          audioStreamEndedRef.current,
        );
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
      if (
        document.visibilityState === "hidden" &&
        (startingRef.current || startAbortControllerRef.current || mediaStreamRef.current || sessionRef.current)
      ) {
        void stop("ended");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [stop]);

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
          void retryPendingRelease();
          return;
        }
        if (
          (startingRef.current || startAbortControllerRef.current || mediaStreamRef.current || sessionRef.current)
        ) void stop("ended");
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
  }, [retryPendingRelease, stop]);

  useEffect(() => () => {
    void stop("ended");
  }, [stop]);

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
    interrupt,
  };
}
