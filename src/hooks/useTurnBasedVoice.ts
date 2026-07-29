import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import {
  createVoiceReservation,
  isVoiceReservationRecoverable,
  markVoiceReservationEnding,
  type VoiceReservation,
} from "../lib/voiceReservation";
import {
  createReleaseOnce,
  VoiceSessionLifecycle,
  type VoiceSessionInteractionReason,
  type VoiceSessionReleaseReason,
} from "../lib/voiceSessionLifecycle";
import {
  getAdaptiveSilenceMs,
  runVoiceTurn,
  VoiceTurnPipelineError,
  type VoiceTurnCheckpoint,
  type VoiceTurnPhase,
} from "../lib/voiceTurnPipeline";
import {
  AdaptiveBargeInDetector,
  calculateVoiceRms,
} from "../lib/voiceBargeIn";
import { VoiceMicrophoneSession } from "../lib/voiceMicrophoneSession";
import {
  createVoiceTranscriptionFormData,
  MAX_VOICE_AUDIO_BYTES,
} from "../lib/voiceTranscription";
import { readVoiceAudioResponse } from "../lib/voiceAudioResponse";
import {
  applyVoicePlaybackFadeIn,
  stopVoicePlaybackSource,
} from "../lib/voicePlaybackEnvelope";
import type { ConversationMessage, VoiceState } from "../types/live";

export type VoiceStartMode = "fresh_start" | "recovery_resume";

type VoiceErrorCode =
  | "subscription_required"
  | "session_active"
  | "daily_limit"
  | "recovery_unavailable"
  | "permission_denied"
  | "connection_failed"
  | null;

type TurnBasedVoiceOptions = {
  userId: string;
  history: ConversationMessage[];
  shadowNotes: string | null;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  reservation: VoiceReservation | null;
  onReservationChange: (reservation: VoiceReservation | null) => void;
  liveReady: boolean;
  apiStatusConnectionError?: string;
};

type ApiErrorBody = {
  error?: string;
  reason?: Exclude<VoiceErrorCode, null>;
  retryAfterSeconds?: number | null;
  httpStatus?: number;
};

type VoiceTimingKey =
  | "recording_started_at"
  | "speech_started_at"
  | "speech_finished_at"
  | "recording_stop_requested_at"
  | "recording_finished_at"
  | "transcription_started_at"
  | "transcription_finished_at"
  | "llm_started_at"
  | "llm_finished_at"
  | "tts_started_at"
  | "tts_finished_at"
  | "playback_started_at"
  | "playback_finished_at"
  | "barge_in_detected_at"
  | "playback_stopped_at"
  | "recording_restarted_at";

type VoiceTurnDiagnostics = {
  turnId: string;
  sessionGeneration: number;
  startMode: VoiceStartMode;
  timestamps: Partial<Record<VoiceTimingKey, string>>;
  marks: Partial<Record<VoiceTimingKey, number>>;
  decodeMs?: number;
};

type VoicePlaybackStopReason =
  | "completed"
  | "manual_interrupt"
  | "barge_in_interrupt"
  | "cleanup"
  | "superseded";

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const MAX_RECORDING_MS = 45_000;
const MIN_SPEECH_MS = 450;
const SPEECH_RMS_THRESHOLD = 0.022;

const getRecordingMimeType = () => {
  for (const mimeType of RECORDING_MIME_TYPES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return "";
};

export const createClientReservationHandle = () => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const parseApiResponse = async <T,>(response: Response): Promise<T> => {
  const data = (await response.json().catch(() => ({}))) as T & ApiErrorBody;
  if (!response.ok) {
    const error = new Error(
      data.error || `Voice request failed (${response.status}).`,
    ) as Error & ApiErrorBody;
    error.reason = data.reason;
    error.retryAfterSeconds = data.retryAfterSeconds;
    error.httpStatus = response.status;
    throw error;
  }
  return data;
};

const normalizeMessages = (messages: ConversationMessage[]) =>
  messages
    .filter((message) => message.content.trim())
    .slice(-24)
    .map((message) => ({
      role: message.role === "ai" ? "ai" as const : "user" as const,
      content: message.content.trim(),
    }));

const markTiming = (diagnostics: VoiceTurnDiagnostics, key: VoiceTimingKey) => {
  diagnostics.timestamps[key] = new Date().toISOString();
  diagnostics.marks[key] = performance.now();
};

const markTimingAt = (
  diagnostics: VoiceTurnDiagnostics,
  key: VoiceTimingKey,
  mark: number,
) => {
  diagnostics.marks[key] = mark;
  diagnostics.timestamps[key] = new Date(
    Date.now() - Math.max(0, performance.now() - mark),
  ).toISOString();
};

const durationBetween = (
  diagnostics: VoiceTurnDiagnostics,
  start: VoiceTimingKey,
  end: VoiceTimingKey,
) => {
  const startMark = diagnostics.marks[start];
  const endMark = diagnostics.marks[end];
  return typeof startMark === "number" && typeof endMark === "number"
    ? Math.max(0, Math.round(endMark - startMark))
    : null;
};

const logVoiceEvent = (event: string, details: Record<string, unknown> = {}) => {
  console.info("[Bible Nova voice]", { event, ...details });
};

const logVoiceInteraction = (
  reason: VoiceSessionInteractionReason,
  details: Record<string, unknown> = {},
) => {
  logVoiceEvent(reason, details);
};

const logTurnMetrics = (diagnostics: VoiceTurnDiagnostics) => {
  logVoiceEvent("turn_metrics", {
    turnId: diagnostics.turnId,
    sessionGeneration: diagnostics.sessionGeneration,
    startMode: diagnostics.startMode,
    ...diagnostics.timestamps,
    silence_wait_ms: durationBetween(
      diagnostics,
      "speech_finished_at",
      "recording_stop_requested_at",
    ),
    blob_prepare_ms: durationBetween(
      diagnostics,
      "recording_stop_requested_at",
      "recording_finished_at",
    ),
    upload_to_transcript_ms: durationBetween(
      diagnostics,
      "transcription_started_at",
      "transcription_finished_at",
    ),
    llm_ms: durationBetween(
      diagnostics,
      "llm_started_at",
      "llm_finished_at",
    ),
    tts_ms: durationBetween(
      diagnostics,
      "tts_started_at",
      "tts_finished_at",
    ),
    decode_ms: diagnostics.decodeMs ?? null,
    pause_to_first_audio_ms: durationBetween(
      diagnostics,
      "recording_finished_at",
      "playback_started_at",
    ),
    playback_to_listening_ms: durationBetween(
      diagnostics,
      diagnostics.marks.playback_stopped_at
        ? "playback_stopped_at"
        : "playback_finished_at",
      "recording_restarted_at",
    ),
    barge_in_stop_latency_ms: durationBetween(
      diagnostics,
      "barge_in_detected_at",
      "playback_stopped_at",
    ),
  });
};

export function useTurnBasedVoice({
  userId,
  history,
  shadowNotes,
  onUserTranscript,
  onAssistantTranscript,
  reservation,
  onReservationChange,
  liveReady,
  apiStatusConnectionError,
}: TurnBasedVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceErrorCode>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);
  const [retryPhase, setRetryPhase] = useState<VoiceTurnPhase | null>(null);

  const stateRef = useRef<VoiceState>("idle");
  const historyRef = useRef(history);
  const shadowNotesRef = useRef(shadowNotes);
  const reservationRef = useRef(reservation);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const operationRef = useRef(0);
  const recordingOperationRef = useRef(0);
  const playbackOperationRef = useRef(0);
  const ttsOperationRef = useRef(0);
  const currentSessionGenerationRef = useRef(0);
  const currentStartModeRef = useRef<VoiceStartMode>("fresh_start");
  const lifecycleRef = useRef<VoiceSessionLifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = new VoiceSessionLifecycle();
  const releaseOnceRef = useRef(createReleaseOnce());
  const stopPromisesRef = useRef(new Map<number, Promise<void>>());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const microphoneSessionRef = useRef<VoiceMicrophoneSession | null>(null);
  if (!microphoneSessionRef.current) {
    microphoneSessionRef.current = new VoiceMicrophoneSession();
  }
  const discardedRecordersRef = useRef(new WeakSet<MediaRecorder>());
  const recordingDiagnosticsRef = useRef<VoiceTurnDiagnostics | null>(null);
  const recordingStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTimerOperationRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const bargeInDetectorRef = useRef(new AdaptiveBargeInDetector());
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackGainRef = useRef<GainNode | null>(null);
  const playbackResolveRef = useRef<(() => void) | null>(null);
  const playbackDiagnosticsRef = useRef<VoiceTurnDiagnostics | null>(null);
  const retryCheckpointRef = useRef<VoiceTurnCheckpoint | null>(null);
  const retryDiagnosticsRef = useRef<VoiceTurnDiagnostics | null>(null);
  const microphonePermissionKnownRef = useRef(false);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    shadowNotesRef.current = shadowNotes;
  }, [shadowNotes]);
  useEffect(() => {
    reservationRef.current = reservation;
  }, [reservation]);

  const transition = useCallback((next: VoiceState, details: Record<string, unknown> = {}) => {
    const previous = stateRef.current;
    stateRef.current = next;
    setState(next);
    if (previous !== next) {
      logVoiceEvent("state_transition", {
        from: previous,
        to: next,
        sessionGeneration: currentSessionGenerationRef.current || null,
        ...details,
      });
    }
  }, []);

  const clearRecordingTimer = useCallback((operation?: number) => {
    if (
      operation !== undefined &&
      recordingTimerOperationRef.current !== null &&
      recordingTimerOperationRef.current !== operation
    ) {
      return;
    }
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    recordingTimerOperationRef.current = null;
  }, []);

  const stopVad = useCallback(() => {
    if (vadFrameRef.current !== null) {
      window.cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    bargeInDetectorRef.current.resetCandidate();
  }, []);

  const releaseStream = useCallback((expectedStream?: MediaStream | null) => {
    const microphoneSession = microphoneSessionRef.current!;
    if (expectedStream && !microphoneSession.owns(expectedStream)) {
      microphoneSession.release(expectedStream);
      return;
    }
    stopVad();
    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;
    analyserRef.current = null;
    if (microphoneSession.release(expectedStream)) {
      logVoiceEvent("mic_stream_released", {
        sessionGeneration: currentSessionGenerationRef.current || null,
      });
    }
  }, [stopVad]);

  const stopPlayback = useCallback((
    reason: VoicePlaybackStopReason = "superseded",
  ) => {
    stopVad();
    const source = playbackSourceRef.current;
    playbackSourceRef.current = null;
    const gain = playbackGainRef.current;
    playbackGainRef.current = null;
    const diagnostics = playbackDiagnosticsRef.current;
    playbackDiagnosticsRef.current = null;
    const resolvePlayback = playbackResolveRef.current;
    playbackResolveRef.current = null;
    if (diagnostics && !diagnostics.marks.playback_stopped_at) {
      markTiming(diagnostics, "playback_stopped_at");
    }
    if (source) {
      source.onended = null;
      const context = audioContextRef.current;
      if (gain && context && context.state === "running") {
        try {
          stopVoicePlaybackSource({
            context,
            source,
            gain,
            fadeOut:
              reason === "manual_interrupt" ||
              reason === "barge_in_interrupt",
          });
        } catch {
          try {
            source.stop();
          } catch {
            // The source may already have ended.
          }
          try {
            source.disconnect();
          } catch {
            // The source may already be disconnected.
          }
          try {
            gain.disconnect();
          } catch {
            // The gain may already be disconnected.
          }
        }
      } else {
        try {
          source.stop();
        } catch {
          // The source may already have ended.
        }
        try {
          source.disconnect();
        } catch {
          // The source may already be disconnected.
        }
        try {
          gain?.disconnect();
        } catch {
          // The gain may already be disconnected.
        }
      }
    } else {
      try {
        gain?.disconnect();
      } catch {
        // The gain may already be disconnected.
      }
    }
    if (source && reason !== "completed") {
      logVoiceEvent("playback_cancelled", {
        turnId: diagnostics?.turnId || null,
        sessionGeneration: currentSessionGenerationRef.current || null,
        reason,
      });
    }
    resolvePlayback?.();
  }, [stopVad]);

  const primeAudioForUserGesture = useCallback(() => {
    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextConstructor) return;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextConstructor();
    }
    void audioContextRef.current.resume().catch(() => undefined);
  }, []);

  const ensureMicrophoneGraph = useCallback(async (stream: MediaStream) => {
    const context = audioContextRef.current;
    if (!context || context.state === "closed") return null;
    await context.resume().catch(() => undefined);
    if (mediaSourceRef.current && analyserRef.current) {
      return analyserRef.current;
    }

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.2;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    mediaSourceRef.current = source;
    analyserRef.current = analyser;
    return analyser;
  }, []);

  const releaseReservation = useCallback(async (
    target: VoiceReservation | null,
    releaseReason: VoiceSessionReleaseReason,
    sessionGeneration: number,
  ) => {
    if (!target?.handle) return;

    if (reservationRef.current?.handle === target.handle) {
      const endingReservation = markVoiceReservationEnding(target);
      reservationRef.current = endingReservation;
      onReservationChange(endingReservation);
    }

    await releaseOnceRef.current(target.handle, async () => {
      const response = await apiFetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "release",
          reservationHandle: target.handle,
          releaseReason,
        }),
      });
      logVoiceEvent("session_released", {
        sessionGeneration,
        releaseReason,
        providerHttpStatus: response.status,
      });
    }).catch((caught) => {
      logVoiceEvent("reservation_release_failed", {
        sessionGeneration,
        releaseReason,
        reason: caught instanceof Error ? caught.message : String(caught),
      });
    });

    if (reservationRef.current?.handle === target.handle) {
      reservationRef.current = null;
      onReservationChange(null);
    }
  }, [onReservationChange]);

  const stop = useCallback((
    finalState: VoiceState = "ended",
    releaseReason: VoiceSessionReleaseReason = "user_end",
  ) => {
    const sessionGeneration = currentSessionGenerationRef.current;
    if (!sessionGeneration) {
      activeRef.current = false;
      setIsSessionActive(false);
      transition(finalState);
      return Promise.resolve();
    }

    const existing = stopPromisesRef.current.get(sessionGeneration);
    if (existing) return existing;

    const targetReservation = reservationRef.current;
    const targetContext = audioContextRef.current;
    const cleanup = (async () => {
      const ownsCurrentSession =
        currentSessionGenerationRef.current === sessionGeneration;
      if (ownsCurrentSession) {
        activeRef.current = false;
        lifecycleRef.current!.invalidate(sessionGeneration);
        operationRef.current += 1;
        recordingOperationRef.current += 1;
        playbackOperationRef.current += 1;
        ttsOperationRef.current += 1;
        requestControllerRef.current?.abort();
        requestControllerRef.current = null;
        clearRecordingTimer();
        const recorder = recorderRef.current;
        if (recorder) discardedRecordersRef.current.add(recorder);
        recorderRef.current = null;
        recordingDiagnosticsRef.current = null;
        if (recorder?.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Continue cleanup if the recorder stopped concurrently.
          }
        }
        releaseStream();
        stopPlayback("cleanup");
        transition(finalState === "ended" ? "ending" : finalState, {
          releaseReason,
        });
      }

      await releaseReservation(targetReservation, releaseReason, sessionGeneration);

      if (audioContextRef.current === targetContext) {
        audioContextRef.current = null;
        if (targetContext && targetContext.state !== "closed") {
          await targetContext.close().catch(() => undefined);
        }
      }

      if (currentSessionGenerationRef.current === sessionGeneration) {
        currentSessionGenerationRef.current = 0;
        setIsSessionActive(false);
        retryCheckpointRef.current = null;
        retryDiagnosticsRef.current = null;
        setRetryPhase(null);
        setIsMuted(false);
        mutedRef.current = false;
        transition(finalState, { releaseReason });
      }
    })();

    stopPromisesRef.current.set(sessionGeneration, cleanup);
    void cleanup.finally(() => {
      if (stopPromisesRef.current.get(sessionGeneration) === cleanup) {
        stopPromisesRef.current.delete(sessionGeneration);
      }
    });
    return cleanup;
  }, [
    clearRecordingTimer,
    releaseReservation,
    releaseStream,
    stopPlayback,
    transition,
  ]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const beginRecordingRef = useRef<
    (
      restartDiagnostics?: VoiceTurnDiagnostics,
      fromBargeIn?: boolean,
    ) => Promise<boolean>
  >(async () => false);
  const interruptFromUserSpeechRef = useRef<
    (diagnostics: VoiceTurnDiagnostics) => void
  >(() => undefined);

  const startBargeInVad = useCallback((
    diagnostics: VoiceTurnDiagnostics,
    playbackOperation: number,
  ) => {
    stopVad();
    const analyser = analyserRef.current;
    if (!analyser || mutedRef.current) return;
    const samples = new Float32Array(analyser.fftSize);
    const monitor = () => {
      if (
        !activeRef.current ||
        mutedRef.current ||
        playbackOperation !== playbackOperationRef.current ||
        stateRef.current !== "assistant-speaking" ||
        !playbackSourceRef.current
      ) {
        vadFrameRef.current = null;
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      const rms = calculateVoiceRms(samples);
      if (bargeInDetectorRef.current.observePlayback(rms)) {
        markTiming(diagnostics, "barge_in_detected_at");
        logVoiceEvent("barge_in_detected", {
          turnId: diagnostics.turnId,
          sessionGeneration: diagnostics.sessionGeneration,
          threshold: Number(
            bargeInDetectorRef.current.getThreshold().toFixed(4),
          ),
        });
        interruptFromUserSpeechRef.current(diagnostics);
        return;
      }
      vadFrameRef.current = window.requestAnimationFrame(monitor);
    };
    vadFrameRef.current = window.requestAnimationFrame(monitor);
  }, [stopVad]);

  const playResponse = useCallback(async (
    audio: ArrayBuffer,
    operation: number,
    diagnostics: VoiceTurnDiagnostics,
  ) => {
    const context = audioContextRef.current;
    if (!context || context.state === "closed") {
      throw new Error("Audio playback is unavailable. The reply is saved in Chat.");
    }
    const audioContextStateBeforeResume = context.state;
    await context.resume();
    const decodeStartedAt = performance.now();
    const audioBuffer = await context.decodeAudioData(audio.slice(0));
    const audioDecodeDurationMs = Math.round(performance.now() - decodeStartedAt);
    diagnostics.decodeMs = audioDecodeDurationMs;
    if (!activeRef.current || operation !== operationRef.current) {
      logVoiceEvent("stale_tts_discarded", {
        turnId: diagnostics.turnId,
        sessionGeneration: diagnostics.sessionGeneration,
        stage: "decoded_audio",
      });
      return;
    }

    stopPlayback("superseded");
    const playbackOperation = playbackOperationRef.current + 1;
    playbackOperationRef.current = playbackOperation;
    const source = context.createBufferSource();
    const gain = context.createGain();
    source.buffer = audioBuffer;
    applyVoicePlaybackFadeIn(context, gain);
    source.connect(gain);
    gain.connect(context.destination);
    playbackSourceRef.current = source;
    playbackGainRef.current = gain;
    playbackDiagnosticsRef.current = diagnostics;
    transition("assistant-speaking", {
      turnId: diagnostics.turnId,
      audioContextStateBeforeResume,
      audioContextState: context.state,
      audioDecodeDurationMs,
    });

    await new Promise<void>((resolve) => {
      playbackResolveRef.current = resolve;
      source.onended = () => {
        if (playbackSourceRef.current === source) playbackSourceRef.current = null;
        if (playbackGainRef.current === gain) playbackGainRef.current = null;
        if (playbackResolveRef.current === resolve) playbackResolveRef.current = null;
        if (playbackDiagnosticsRef.current === diagnostics) {
          playbackDiagnosticsRef.current = null;
        }
        stopVad();
        source.disconnect();
        gain.disconnect();
        markTiming(diagnostics, "playback_finished_at");
        markTiming(diagnostics, "playback_stopped_at");
        resolve();
      };
      markTiming(diagnostics, "playback_started_at");
      source.start();
      startBargeInVad(diagnostics, playbackOperation);
    });
  }, [startBargeInVad, stopPlayback, stopVad, transition]);

  const processCheckpoint = useCallback(async (
    checkpoint: VoiceTurnCheckpoint,
    operation: number,
    diagnostics: VoiceTurnDiagnostics,
  ) => {
    if (
      !activeRef.current ||
      operation !== operationRef.current ||
      !lifecycleRef.current!.isCurrent(diagnostics.sessionGeneration)
    ) {
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current?.abort();
    requestControllerRef.current = controller;
    retryCheckpointRef.current = checkpoint;
    retryDiagnosticsRef.current = diagnostics;
    setError(null);
    setErrorCode(null);
    setRetryPhase(null);

    try {
      const result = await runVoiceTurn(checkpoint, {
        isCurrent: () =>
          activeRef.current &&
          operation === operationRef.current &&
          lifecycleRef.current!.isCurrent(diagnostics.sessionGeneration) &&
          !lifecycleRef.current!.isExpired(diagnostics.sessionGeneration),
        isMuted: () => mutedRef.current,
        onPhase: (phase) => {
          setRetryPhase(null);
          if (phase === "transcription") {
            transition("transcribing", { turnId: diagnostics.turnId, phase });
            setSessionNotice("I'm with you…");
          } else if (phase === "response") {
            transition("thinking", { turnId: diagnostics.turnId, phase });
            setSessionNotice("Holding your words with care…");
          } else if (phase === "tts") {
            transition("preparing-voice", { turnId: diagnostics.turnId, phase });
            setSessionNotice("Preparing a gentle response…");
          } else if (phase === "restart") {
            transition("restarting-listener", {
              turnId: diagnostics.turnId,
              phase,
            });
            setSessionNotice("Listening for your next reflection…");
          }
        },
        transcribe: async (blob) => {
          const formData = createVoiceTranscriptionFormData(blob, "en");
          markTiming(diagnostics, "transcription_started_at");
          const response = await apiFetch("/api/transcribe", {
            method: "POST",
            headers: {
              "X-Client-Request-Id": diagnostics.turnId,
            },
            body: formData,
            signal: controller.signal,
          });
          logVoiceEvent("provider_response", {
            turnId: diagnostics.turnId,
            phase: "transcription",
            providerHttpStatus: response.status,
          });
          const transcription = await parseApiResponse<{ text?: string }>(response);
          markTiming(diagnostics, "transcription_finished_at");
          return transcription.text?.trim() || "";
        },
        commitUser: (text) => {
          onUserTranscript(text);
          historyRef.current = [
            ...historyRef.current,
            {
              id: crypto.randomUUID(),
              role: "user",
              content: text,
              source: "voice",
            },
          ];
        },
        respond: async () => {
          markTiming(diagnostics, "llm_started_at");
          const response = await apiFetch("/api/voice/respond", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Client-Request-Id": diagnostics.turnId,
            },
            body: JSON.stringify({
              mode: "voice",
              messages: normalizeMessages(historyRef.current),
              shadowNotes: shadowNotesRef.current,
            }),
            signal: controller.signal,
          });
          if (
            operation !== operationRef.current ||
            !lifecycleRef.current!.isCurrent(diagnostics.sessionGeneration)
          ) {
            logVoiceEvent("stale_response_discarded", {
              turnId: diagnostics.turnId,
              sessionGeneration: diagnostics.sessionGeneration,
            });
            throw new DOMException("Voice turn was superseded.", "AbortError");
          }
          logVoiceEvent("provider_response", {
            turnId: diagnostics.turnId,
            phase: "response",
            providerHttpStatus: response.status,
          });
          const result = await parseApiResponse<{ message?: string }>(response);
          markTiming(diagnostics, "llm_finished_at");
          return result.message?.trim() || "";
        },
        commitAssistant: (text) => {
          onAssistantTranscript(text);
          historyRef.current = [
            ...historyRef.current,
            {
              id: crypto.randomUUID(),
              role: "ai",
              content: text,
              source: "voice",
            },
          ];
        },
        synthesize: async (text) => {
          const ttsOperation = ttsOperationRef.current + 1;
          ttsOperationRef.current = ttsOperation;
          markTiming(diagnostics, "tts_started_at");
          const response = await apiFetch("/api/tts", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "audio/mpeg",
              "X-Client-Request-Id": diagnostics.turnId,
            },
            body: JSON.stringify({ text }),
            signal: controller.signal,
          });
          if (
            ttsOperation !== ttsOperationRef.current ||
            operation !== operationRef.current ||
            !lifecycleRef.current!.isCurrent(diagnostics.sessionGeneration)
          ) {
            logVoiceEvent("stale_tts_discarded", {
              turnId: diagnostics.turnId,
              sessionGeneration: diagnostics.sessionGeneration,
            });
            throw new DOMException("Voice audio was superseded.", "AbortError");
          }
          logVoiceEvent("provider_response", {
            turnId: diagnostics.turnId,
            phase: "tts",
            providerHttpStatus: response.status,
          });
          if (!response.ok) {
            await parseApiResponse(response);
          }

          const audio = await readVoiceAudioResponse(response);
          markTiming(diagnostics, "tts_finished_at");
          return audio;
        },
        play: (audio) => playResponse(audio, operation, diagnostics),
        restartListening: () => beginRecordingRef.current(diagnostics),
        setReady: () => {
          setSessionNotice("Microphone paused.");
          transition("paused", { turnId: diagnostics.turnId });
        },
      });

      if (result === "stale") return;
      retryCheckpointRef.current = null;
      retryDiagnosticsRef.current = null;
      setRetryPhase(null);
      setError(null);
      setErrorCode(null);
      if (result === "completed") setSessionNotice(null);
      logTurnMetrics(diagnostics);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (
        !activeRef.current ||
        operation !== operationRef.current ||
        !lifecycleRef.current!.isCurrent(diagnostics.sessionGeneration)
      ) {
        return;
      }

      const pipelineError =
        caught instanceof VoiceTurnPipelineError
          ? caught
          : new VoiceTurnPipelineError("response", checkpoint, caught);
      retryCheckpointRef.current = pipelineError.checkpoint;
      retryDiagnosticsRef.current = diagnostics;
      setRetryPhase(pipelineError.phase);
      setErrorCode("connection_failed");

      const fallbackMessage =
        pipelineError.phase === "transcription"
          ? "I couldn't transcribe that recording. Please try it again."
          : pipelineError.phase === "response"
            ? "I saved what you said, but couldn't prepare a response. Please try again."
            : pipelineError.phase === "restart"
              ? "The response is complete, but the microphone could not restart."
              : "Voice unavailable, response saved in Chat.";
      setError(pipelineError.message || fallbackMessage);
      setSessionNotice(
        pipelineError.phase === "restart"
          ? "Try listening again or continue in Chat."
          : pipelineError.phase === "tts" || pipelineError.phase === "playback"
            ? "The written response is safe in Chat. You can retry its audio."
            : "Retry this turn or continue in Chat.",
      );
      transition("error", {
        turnId: diagnostics.turnId,
        phase: pipelineError.phase,
      });
      logTurnMetrics(diagnostics);
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
    }
  }, [
    onAssistantTranscript,
    onUserTranscript,
    playResponse,
    transition,
  ]);

  const processRecording = useCallback(async (
    blob: Blob,
    operation: number,
    diagnostics: VoiceTurnDiagnostics,
  ) => {
    if (!activeRef.current || operation !== operationRef.current) return;
    if (!blob.size) {
      setSessionNotice("I did not catch anything. Please try again.");
      await beginRecordingRef.current();
      return;
    }
    if (blob.size > MAX_VOICE_AUDIO_BYTES) {
      setSessionNotice("That was a little long. Please try a shorter reflection.");
      await beginRecordingRef.current();
      return;
    }

    const checkpoint: VoiceTurnCheckpoint = { blob };
    await processCheckpoint(checkpoint, operation, diagnostics);
  }, [processCheckpoint]);

  const finishTurn = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    const operation = operationRef.current;
    const recordingOperation = recordingOperationRef.current;
    clearRecordingTimer(recordingOperation);
    stopVad();
    const diagnostics = recordingDiagnosticsRef.current;
    if (diagnostics) {
      const speechFinishedAt = lastSpeechAtRef.current;
      if (speechFinishedAt !== null && !diagnostics.marks.speech_finished_at) {
        markTimingAt(diagnostics, "speech_finished_at", speechFinishedAt);
      }
      markTiming(diagnostics, "recording_stop_requested_at");
    }
    transition("finishing-user-turn");
    setSessionNotice("I'm with you…");
    try {
      recorder.requestData();
      recorder.stop();
    } catch {
      recorderRef.current = null;
      recordingDiagnosticsRef.current = null;
      releaseStream();
      setError("The microphone stopped unexpectedly. Please try again.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
    }
  }, [clearRecordingTimer, releaseStream, stopVad, transition]);

  const beginRecording = useCallback(async (
    restartDiagnostics?: VoiceTurnDiagnostics,
    fromBargeIn = false,
  ): Promise<boolean> => {
    if (!activeRef.current || mutedRef.current) {
      if (activeRef.current) transition("paused");
      return false;
    }

    const sessionGeneration = currentSessionGenerationRef.current;
    if (
      !lifecycleRef.current!.isCurrent(sessionGeneration) ||
      lifecycleRef.current!.isExpired(sessionGeneration)
    ) {
      setSessionNotice("This Voice reflection has reached its session limit.");
      void stopRef.current("ended", "session_expired");
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable on this device.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
      return false;
    }

    const operation = operationRef.current;
    if (!microphonePermissionKnownRef.current) transition("requesting-permission");
    setError(null);
    setErrorCode(null);
    setSessionNotice(null);
    let stream: MediaStream;
    let streamReused = false;
    try {
      if (
        !microphonePermissionKnownRef.current &&
        isNativePlatform() &&
        getNativePlatform() === "android"
      ) {
        try {
          const { SpeechRecognition } = await import(
            "@capgo/capacitor-speech-recognition"
          );
          const current = await SpeechRecognition.checkPermissions();
          logVoiceEvent("android_microphone_permission", {
            sessionGeneration,
            result: current.speechRecognition,
          });
          if (current.speechRecognition !== "granted") {
            const requested = await SpeechRecognition.requestPermissions();
            logVoiceEvent("android_microphone_permission_request", {
              sessionGeneration,
              result: requested.speechRecognition,
            });
            if (requested.speechRecognition !== "granted") {
              throw new DOMException("Microphone permission denied.", "NotAllowedError");
            }
          }
        } catch (permissionBridgeError) {
          if (
            permissionBridgeError instanceof DOMException &&
            permissionBridgeError.name === "NotAllowedError"
          ) {
            throw permissionBridgeError;
          }
          // WebView getUserMedia remains a valid Android fallback when the
          // optional native permission bridge is unavailable or not synced.
          logVoiceEvent("android_microphone_permission_bridge_failed", {
            sessionGeneration,
            reason:
              permissionBridgeError instanceof Error
                ? permissionBridgeError.message
                : String(permissionBridgeError),
          });
        }
      }
      const acquisition = await microphoneSessionRef.current!.acquire(() =>
        navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
          },
        }));
      stream = acquisition.stream;
      streamReused = acquisition.reused;
      microphoneSessionRef.current!.setEnabled(true);
      if (!streamReused && mediaSourceRef.current) {
        mediaSourceRef.current.disconnect();
        mediaSourceRef.current = null;
        analyserRef.current = null;
      }
      await ensureMicrophoneGraph(stream).catch((graphError) => {
        mediaSourceRef.current?.disconnect();
        mediaSourceRef.current = null;
        analyserRef.current = null;
        logVoiceEvent("microphone_analyser_unavailable", {
          sessionGeneration,
          reason:
            graphError instanceof Error
              ? graphError.message
              : String(graphError),
        });
        return null;
      });
      logVoiceEvent(streamReused ? "mic_stream_reused" : "mic_stream_recreated", {
        sessionGeneration,
      });
      microphonePermissionKnownRef.current = true;
    } catch (caught) {
      microphonePermissionKnownRef.current = false;
      const name = caught instanceof Error ? caught.name.toLowerCase() : "";
      const denied = name.includes("notallowed") || name.includes("permission");
      setError(
        denied
          ? "Microphone access was denied. Allow it in Android settings and try again."
          : "The microphone could not start. Please try again.",
      );
      setErrorCode(denied ? "permission_denied" : "connection_failed");
      setRetryPhase("restart");
      transition(denied ? "permission-denied" : "error");
      return false;
    }

    if (
      !activeRef.current ||
      operation !== operationRef.current ||
      !lifecycleRef.current!.isCurrent(sessionGeneration)
    ) {
      microphoneSessionRef.current!.release(stream);
      return false;
    }

    const mimeType = getRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream(stream);
      setError("Audio recording could not start on this device.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
      return false;
    }

    recorderRef.current = recorder;
    const recordingOperation = recordingOperationRef.current + 1;
    recordingOperationRef.current = recordingOperation;
    const diagnostics: VoiceTurnDiagnostics = {
      turnId: crypto.randomUUID(),
      sessionGeneration,
      startMode: currentStartModeRef.current,
      timestamps: {},
      marks: {},
    };
    recordingDiagnosticsRef.current = diagnostics;
    const recorderChunks: Blob[] = [];
    recordingStartedAtRef.current = performance.now();
    speechStartedAtRef.current = null;
    lastSpeechAtRef.current = null;

    recorder.ondataavailable = (event) => {
      if (event.data.size) recorderChunks.push(event.data);
    };
    recorder.onerror = () => {
      const staleRecorder =
        recordingOperation !== recordingOperationRef.current ||
        operation !== operationRef.current ||
        discardedRecordersRef.current.has(recorder);
      discardedRecordersRef.current.add(recorder);
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (staleRecorder) {
        if (!microphoneSessionRef.current!.owns(stream)) {
          microphoneSessionRef.current!.release(stream);
        }
        return;
      }
      clearRecordingTimer(recordingOperation);
      if (recordingDiagnosticsRef.current === diagnostics) {
        recordingDiagnosticsRef.current = null;
      }
      recordingOperationRef.current += 1;
      releaseStream(stream);
      setError("Microphone recording failed. Please try again.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
    };
    recorder.onstop = () => {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
      const discard =
        discardedRecordersRef.current.has(recorder) ||
        recordingOperation !== recordingOperationRef.current ||
        operation !== operationRef.current;
      if (!discard) {
        clearRecordingTimer(recordingOperation);
        stopVad();
        if (recordingDiagnosticsRef.current === diagnostics) {
          recordingDiagnosticsRef.current = null;
        }
      }
      discardedRecordersRef.current.delete(recorder);
      if (!diagnostics.marks.recording_stop_requested_at) {
        markTiming(diagnostics, "recording_stop_requested_at");
      }
      markTiming(diagnostics, "recording_finished_at");
      const blob = new Blob(recorderChunks, {
        type: recorderChunks[0]?.type || recorder.mimeType || "audio/webm",
      });
      if (!discard) void processRecording(blob, operation, diagnostics);
    };

    const analyser = analyserRef.current;
    if (analyser) {
      const samples = new Float32Array(analyser.fftSize);
      const monitor = () => {
        if (
          recorderRef.current !== recorder ||
          recorder.state === "inactive" ||
          recordingOperation !== recordingOperationRef.current
        ) {
          vadFrameRef.current = null;
          return;
        }
        analyser.getFloatTimeDomainData(samples);
        const rms = calculateVoiceRms(samples);
        const now = performance.now();
        const speechThreshold = Math.max(
          SPEECH_RMS_THRESHOLD,
          bargeInDetectorRef.current.getNoiseFloor() * 1.8,
        );
        if (rms >= speechThreshold) {
          if (speechStartedAtRef.current === null) {
            speechStartedAtRef.current = now;
            markTimingAt(diagnostics, "speech_started_at", now);
            transition("user-speaking");
          }
          lastSpeechAtRef.current = now;
        } else if (speechStartedAtRef.current !== null) {
          const speechDuration = now - speechStartedAtRef.current;
          const silenceDuration = now - (lastSpeechAtRef.current || now);
          const requiredSilence = getAdaptiveSilenceMs(speechDuration);
          if (speechDuration >= MIN_SPEECH_MS && silenceDuration >= requiredSilence) {
            finishTurn();
            return;
          }
        } else {
          bargeInDetectorRef.current.observeAmbient(rms);
        }
        vadFrameRef.current = window.requestAnimationFrame(monitor);
      };
      vadFrameRef.current = window.requestAnimationFrame(monitor);
    }

    try {
      recorder.start(250);
      recordingStartedAtRef.current = performance.now();
      markTimingAt(
        diagnostics,
        "recording_started_at",
        recordingStartedAtRef.current,
      );
      transition(fromBargeIn ? "barge-in-listening" : "listening", {
        audioContextState: audioContextRef.current?.state || "missing",
        mediaRecorderMimeType: recorder.mimeType || mimeType || "browser-default",
        microphoneStreamReused: streamReused,
      });
      if (restartDiagnostics) {
        markTiming(restartDiagnostics, "recording_restarted_at");
      }
      recordingTimerOperationRef.current = recordingOperation;
      recordingTimerRef.current = window.setTimeout(
        () => finishTurn(),
        MAX_RECORDING_MS,
      );
      return true;
    } catch {
      if (recorderRef.current === recorder) recorderRef.current = null;
      if (recordingDiagnosticsRef.current === diagnostics) {
        recordingDiagnosticsRef.current = null;
      }
      recordingOperationRef.current += 1;
      releaseStream(stream);
      setError("Audio recording could not start. Please try again.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
      return false;
    }
  }, [
    clearRecordingTimer,
    ensureMicrophoneGraph,
    finishTurn,
    processRecording,
    releaseStream,
    transition,
  ]);
  beginRecordingRef.current = beginRecording;

  const interruptFromUserSpeech = useCallback((
    diagnostics: VoiceTurnDiagnostics,
  ) => {
    if (
      !activeRef.current ||
      mutedRef.current ||
      stateRef.current !== "assistant-speaking"
    ) {
      return;
    }

    operationRef.current += 1;
    playbackOperationRef.current += 1;
    ttsOperationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    retryCheckpointRef.current = null;
    retryDiagnosticsRef.current = null;
    setRetryPhase(null);
    transition("barge-in-listening", { turnId: diagnostics.turnId });
    setSessionNotice("I'm listening…");
    stopPlayback("barge_in_interrupt");
    logVoiceInteraction("barge_in_interrupt", {
      turnId: diagnostics.turnId,
      sessionGeneration: diagnostics.sessionGeneration,
    });
    void beginRecordingRef.current(diagnostics, true).then(
      () => logTurnMetrics(diagnostics),
      () => logTurnMetrics(diagnostics),
    );
  }, [stopPlayback, transition]);
  interruptFromUserSpeechRef.current = interruptFromUserSpeech;

  const start = useCallback(async (
    requestedMode: VoiceStartMode = "fresh_start",
  ) => {
    if (activeRef.current) {
      primeAudioForUserGesture();
      await beginRecording();
      return;
    }
    if (!navigator.onLine) {
      setError("Reconnect to the internet and try Voice again.");
      setErrorCode("connection_failed");
      transition("offline");
      return;
    }

    let mode = requestedMode;
    const savedReservation = reservationRef.current;
    if (
      mode === "recovery_resume" &&
      !isVoiceReservationRecoverable(savedReservation, userId)
    ) {
      reservationRef.current = null;
      onReservationChange(null);
      mode = "fresh_start";
    }

    primeAudioForUserGesture();
    const sessionGeneration = lifecycleRef.current!.begin();
    currentSessionGenerationRef.current = sessionGeneration;
    currentStartModeRef.current = mode;
    activeRef.current = true;
    setIsSessionActive(true);
    operationRef.current += 1;
    recordingOperationRef.current += 1;
    playbackOperationRef.current += 1;
    ttsOperationRef.current += 1;
    const operation = operationRef.current;
    transition(mode === "recovery_resume" ? "reconnecting" : "connecting", {
      mode,
    });
    setError(null);
    setErrorCode(null);
    setRetryUntil(null);
    setRetryPhase(null);
    setSessionNotice(
      mode === "recovery_resume"
        ? "Restoring your interrupted reflection…"
        : "Confirming premium access…",
    );

    const previousReservation = mode === "fresh_start" ? savedReservation : null;
    if (previousReservation) {
      reservationRef.current = null;
      onReservationChange(null);
    }
    const requestedHandle =
      mode === "recovery_resume" && savedReservation
        ? savedReservation.handle
        : createClientReservationHandle();

    logVoiceEvent("startup_diagnostics", {
      sessionGeneration,
      mode,
      platform: isNativePlatform() ? getNativePlatform() : "web",
      liveReady,
      apiStatusConnectionError: apiStatusConnectionError || null,
      online: navigator.onLine,
      getUserMediaAvailable: Boolean(navigator.mediaDevices?.getUserMedia),
      mediaDevicesAvailable: Boolean(navigator.mediaDevices),
      audioContextState: audioContextRef.current?.state || "missing",
      recoveryReservationPresent: Boolean(savedReservation),
    });

    try {
      const requestSession = () =>
        apiFetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            mode,
            reservationHandle: requestedHandle,
            previousReservationHandle: previousReservation?.handle || null,
          }),
        });

      let response = await requestSession();
      if (
        response.status === 403 &&
        isNativePlatform() &&
        getNativePlatform() === "android"
      ) {
        setSessionNotice("Rechecking your Google Play premium access…");
        const { refreshNativeSubscriptionEntitlement } = await import(
          "../lib/native/subscriptionSync"
        );
        if (await refreshNativeSubscriptionEntitlement().catch(() => false)) {
          response = await requestSession();
        }
      }

      const session = await parseApiResponse<{
        reservationHandle: string;
        reservationExpiresAt: string;
        remainingSeconds: number;
        resumed: boolean;
      }>(response);
      logVoiceEvent("session_response", {
        sessionGeneration,
        mode,
        providerHttpStatus: response.status,
        resumed: session.resumed,
        remainingSeconds: session.remainingSeconds,
        reservationExpiresAt: session.reservationExpiresAt,
      });

      if (
        !activeRef.current ||
        operation !== operationRef.current ||
        !lifecycleRef.current!.isCurrent(sessionGeneration)
      ) {
        const transientReservation = createVoiceReservation({
          handle: session.reservationHandle,
          expiresAt: session.reservationExpiresAt,
          userId,
        });
        await releaseReservation(
          transientReservation,
          "component_unmount",
          sessionGeneration,
        );
        return;
      }
      if (mode === "fresh_start" && session.resumed) {
        throw new Error("A stale Voice reservation was returned for a fresh reflection.");
      }
      if (mode === "recovery_resume" && !session.resumed) {
        throw new Error("The interrupted Voice reflection could not be resumed safely.");
      }
      if (
        !Number.isFinite(session.remainingSeconds) ||
        session.remainingSeconds <= 0
      ) {
        throw new Error("The Voice session has already expired.");
      }

      const nextReservation = createVoiceReservation({
        handle: session.reservationHandle,
        expiresAt: session.reservationExpiresAt,
        userId,
      });
      reservationRef.current = nextReservation;
      onReservationChange(nextReservation);
      const timerInstalled = lifecycleRef.current!.scheduleExpiry(
        sessionGeneration,
        session.remainingSeconds,
        (expiredGeneration) => {
          if (currentSessionGenerationRef.current !== expiredGeneration) return;
          setSessionNotice("This Voice reflection has reached its session limit.");
          void stopRef.current("ended", "session_expired");
        },
      );
      if (!timerInstalled) {
        throw new Error("The Voice session timer could not be started.");
      }

      setSessionNotice(null);
      await beginRecording();
    } catch (caught) {
      if (
        currentSessionGenerationRef.current !== sessionGeneration ||
        operation !== operationRef.current
      ) {
        return;
      }

      const apiError = caught as Error & ApiErrorBody;
      activeRef.current = false;
      setIsSessionActive(false);
      lifecycleRef.current!.invalidate(sessionGeneration);
      currentSessionGenerationRef.current = 0;
      const nextErrorCode = apiError.reason || "connection_failed";
      setErrorCode(nextErrorCode);
      setError(apiError.message || "Voice could not start.");
      if (apiError.retryAfterSeconds) {
        setRetryUntil(Date.now() + apiError.retryAfterSeconds * 1_000);
      }
      if (nextErrorCode === "recovery_unavailable") {
        reservationRef.current = null;
        onReservationChange(null);
        setSessionNotice("Begin a fresh reflection to continue.");
      }
      transition(navigator.onLine ? "error" : "offline", {
        mode,
        providerHttpStatus: apiError.httpStatus || null,
        reason: nextErrorCode,
      });

      // Detach the failed session's context before yielding to lease cleanup.
      // A fast retry can then create its own context without this catch block
      // later closing audio that belongs to the newer session.
      const failedSessionContext = audioContextRef.current;
      audioContextRef.current = null;
      const closeFailedContext = failedSessionContext?.state !== "closed"
        ? failedSessionContext.close().catch(() => undefined)
        : Promise.resolve();

      if (mode === "fresh_start" || nextErrorCode === "recovery_unavailable") {
        const uncertainReservation = createVoiceReservation({
          handle: requestedHandle,
          expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
          userId,
        });
        await releaseReservation(
          uncertainReservation,
          nextErrorCode === "recovery_unavailable" ? "stale_recovery" : "fatal_error",
          sessionGeneration,
        );
      }

      await closeFailedContext;
    }
  }, [
    apiStatusConnectionError,
    beginRecording,
    liveReady,
    onReservationChange,
    primeAudioForUserGesture,
    releaseReservation,
    transition,
    userId,
  ]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      logVoiceInteraction("user_pause", {
        sessionGeneration: currentSessionGenerationRef.current,
      });
      clearRecordingTimer();
      stopVad();
      microphoneSessionRef.current!.setEnabled(false);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        discardedRecordersRef.current.add(recorder);
        recordingOperationRef.current += 1;
        recordingDiagnosticsRef.current = null;
        try {
          recorder.stop();
        } catch {
          if (recorderRef.current === recorder) recorderRef.current = null;
          releaseStream();
          logVoiceEvent("mic_stream_recreated", {
            sessionGeneration: currentSessionGenerationRef.current,
            reason: "pause_stop_failed",
          });
        }
      }
      if (!playbackSourceRef.current) transition("paused");
      setSessionNotice("Microphone paused.");
    } else if (activeRef.current) {
      microphoneSessionRef.current!.setEnabled(true);
      setSessionNotice(null);
      const playbackDiagnostics = playbackDiagnosticsRef.current;
      if (playbackSourceRef.current && playbackDiagnostics) {
        startBargeInVad(playbackDiagnostics, playbackOperationRef.current);
      } else if (
        ![
          "finishing-user-turn",
          "transcribing",
          "thinking",
          "preparing-voice",
          "restarting-listener",
        ].includes(stateRef.current)
      ) {
        void beginRecording();
      }
    }
  }, [
    beginRecording,
    clearRecordingTimer,
    releaseStream,
    startBargeInVad,
    stopVad,
    transition,
  ]);

  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    const diagnostics = playbackDiagnosticsRef.current;
    operationRef.current += 1;
    playbackOperationRef.current += 1;
    ttsOperationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    retryCheckpointRef.current = null;
    retryDiagnosticsRef.current = null;
    setRetryPhase(null);
    stopPlayback("manual_interrupt");
    transition("interrupted");
    setSessionNotice("Response stopped. I'm listening again.");
    logVoiceInteraction("manual_interrupt", {
      turnId: diagnostics?.turnId || null,
      sessionGeneration: currentSessionGenerationRef.current,
    });
    if (mutedRef.current) {
      transition("paused");
      return;
    }
    void beginRecording(diagnostics || undefined).then(
      () => {
        if (diagnostics) logTurnMetrics(diagnostics);
      },
      () => {
        if (diagnostics) logTurnMetrics(diagnostics);
      },
    );
  }, [beginRecording, stopPlayback, transition]);

  const retry = useCallback(async () => {
    if (!navigator.onLine) {
      setError("Reconnect to the internet and try again.");
      transition("offline");
      return;
    }
    if (activeRef.current) {
      setError(null);
      setErrorCode(null);
      setSessionNotice(null);
      const checkpoint = retryCheckpointRef.current;
      const diagnostics = retryDiagnosticsRef.current;
      if (checkpoint && diagnostics) {
        await processCheckpoint(checkpoint, operationRef.current, diagnostics);
      } else {
        await beginRecording();
      }
      return;
    }
    await start(
      isVoiceReservationRecoverable(reservationRef.current, userId)
        ? "recovery_resume"
        : "fresh_start",
    );
  }, [beginRecording, processCheckpoint, start, transition, userId]);

  useEffect(() => {
    const handleOffline = () => {
      if (!activeRef.current) return;
      operationRef.current += 1;
      recordingOperationRef.current += 1;
      playbackOperationRef.current += 1;
      ttsOperationRef.current += 1;
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      clearRecordingTimer();
      stopVad();
      const recorder = recorderRef.current;
      if (recorder) discardedRecordersRef.current.add(recorder);
      if (recorder?.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          if (recorderRef.current === recorder) recorderRef.current = null;
          releaseStream();
        }
      }
      recordingDiagnosticsRef.current = null;
      microphoneSessionRef.current!.setEnabled(false);
      stopPlayback("superseded");
      setError("You're offline. Your reflection is still here.");
      setErrorCode("connection_failed");
      setSessionNotice("Reconnect, then try this turn again.");
      transition("offline");
    };
    const handleOnline = () => {
      if (!activeRef.current || stateRef.current !== "offline") return;
      setError(null);
      setSessionNotice("Connection restored. Tap retry when you're ready.");
      transition("reconnecting");
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [clearRecordingTimer, releaseStream, stopPlayback, stopVad, transition]);

  useEffect(() => {
    if (!isNativePlatform()) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    void import("@capacitor/app")
      .then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          logVoiceEvent("android_app_state", {
            isActive,
            sessionGeneration: currentSessionGenerationRef.current || null,
            state: stateRef.current,
          });
          // Android permission dialogs temporarily background the WebView.
          // The active Voice session deliberately remains intact.
          if (!isActive) return;
          void audioContextRef.current?.resume().catch(() => undefined);
          if (
            !activeRef.current ||
            mutedRef.current ||
            !["listening", "user-speaking", "barge-in-listening"]
              .includes(stateRef.current)
          ) {
            return;
          }
          const stream = microphoneSessionRef.current!.current;
          const streamIsLive = Boolean(
            stream?.getAudioTracks().some((track) => track.readyState === "live"),
          );
          const recorder = recorderRef.current;
          if (streamIsLive && recorder && recorder.state !== "inactive") return;

          if (recorder) discardedRecordersRef.current.add(recorder);
          clearRecordingTimer();
          recordingOperationRef.current += 1;
          releaseStream();
          logVoiceEvent("mic_stream_recreated", {
            sessionGeneration: currentSessionGenerationRef.current,
            reason: "android_resume",
          });
          void beginRecordingRef.current();
        }),
      )
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, [clearRecordingTimer, releaseStream]);

  useEffect(() => () => {
    void stopRef.current("ended", "component_unmount");
  }, []);

  const canRecover = isVoiceReservationRecoverable(reservation, userId);
  const retryLabel =
    retryPhase === "tts" || retryPhase === "playback"
      ? "Retry voice response"
      : retryPhase === "response"
        ? "Retry response"
        : retryPhase === "transcription"
          ? "Retry recording"
          : "Try listening again";

  return {
    state,
    error,
    errorCode,
    sessionNotice,
    isMuted,
    isSessionActive,
    canRecover,
    retryUntil,
    retryLabel,
    start,
    retry,
    stop,
    finishTurn,
    toggleMute,
    interrupt,
    primeAudioForUserGesture,
  };
}
