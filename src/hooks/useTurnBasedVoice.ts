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
  type VoiceSessionReleaseReason,
} from "../lib/voiceSessionLifecycle";
import {
  getAdaptiveSilenceMs,
  runVoiceTurn,
  VoiceTurnPipelineError,
  type VoiceTurnCheckpoint,
  type VoiceTurnPhase,
} from "../lib/voiceTurnPipeline";
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
  | "recording_finished_at"
  | "transcription_started_at"
  | "transcription_finished_at"
  | "llm_started_at"
  | "llm_finished_at"
  | "tts_started_at"
  | "tts_finished_at"
  | "playback_started_at"
  | "playback_finished_at"
  | "recording_restarted_at";

type VoiceTurnDiagnostics = {
  turnId: string;
  sessionGeneration: number;
  startMode: VoiceStartMode;
  timestamps: Partial<Record<VoiceTimingKey, string>>;
  marks: Partial<Record<VoiceTimingKey, number>>;
};

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const MAX_RECORDING_MS = 45_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
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

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Recorded audio could not be prepared."));
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Recorded audio could not be prepared."));
    };
    reader.readAsDataURL(blob);
  });

const base64ToArrayBuffer = (value: string) => {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
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

const logTurnMetrics = (diagnostics: VoiceTurnDiagnostics) => {
  logVoiceEvent("turn_metrics", {
    turnId: diagnostics.turnId,
    sessionGeneration: diagnostics.sessionGeneration,
    startMode: diagnostics.startMode,
    ...diagnostics.timestamps,
    silenceToUploadMs: durationBetween(
      diagnostics,
      "recording_finished_at",
      "transcription_started_at",
    ),
    transcriptionDurationMs: durationBetween(
      diagnostics,
      "transcription_started_at",
      "transcription_finished_at",
    ),
    llmDurationMs: durationBetween(
      diagnostics,
      "llm_started_at",
      "llm_finished_at",
    ),
    ttsDurationMs: durationBetween(
      diagnostics,
      "tts_started_at",
      "tts_finished_at",
    ),
    pauseToFirstAudioMs: durationBetween(
      diagnostics,
      "recording_finished_at",
      "playback_started_at",
    ),
    playbackToListeningRestartMs: durationBetween(
      diagnostics,
      "playback_finished_at",
      "recording_restarted_at",
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
  const currentSessionGenerationRef = useRef(0);
  const currentStartModeRef = useRef<VoiceStartMode>("fresh_start");
  const lifecycleRef = useRef<VoiceSessionLifecycle | null>(null);
  if (!lifecycleRef.current) lifecycleRef.current = new VoiceSessionLifecycle();
  const releaseOnceRef = useRef(createReleaseOnce());
  const stopPromisesRef = useRef(new Map<number, Promise<void>>());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const discardedRecordersRef = useRef(new WeakSet<MediaRecorder>());
  const recordingStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const recordingTimerOperationRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackResolveRef = useRef<(() => void) | null>(null);
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

  const stopVad = useCallback((expectedSource?: MediaStreamAudioSourceNode | null) => {
    if (
      expectedSource &&
      mediaSourceRef.current &&
      mediaSourceRef.current !== expectedSource
    ) {
      expectedSource.disconnect();
      return;
    }
    if (vadFrameRef.current !== null) {
      window.cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;
  }, []);

  const releaseStream = useCallback((
    expectedStream?: MediaStream | null,
    expectedSource?: MediaStreamAudioSourceNode | null,
  ) => {
    if (expectedStream && streamRef.current && streamRef.current !== expectedStream) {
      expectedSource?.disconnect();
      expectedStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stopVad(expectedSource);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, [stopVad]);

  const stopPlayback = useCallback(() => {
    const source = playbackSourceRef.current;
    playbackSourceRef.current = null;
    const resolvePlayback = playbackResolveRef.current;
    playbackResolveRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    }
    resolvePlayback?.();
  }, []);

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
      logVoiceEvent("reservation_release", {
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
        requestControllerRef.current?.abort();
        requestControllerRef.current = null;
        clearRecordingTimer();
        const recorder = recorderRef.current;
        if (recorder) discardedRecordersRef.current.add(recorder);
        recorderRef.current = null;
        if (recorder?.state !== "inactive") {
          try {
            recorder.stop();
          } catch {
            // Continue cleanup if the recorder stopped concurrently.
          }
        }
        releaseStream();
        stopPlayback();
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
    (restartDiagnostics?: VoiceTurnDiagnostics) => Promise<boolean>
  >(async () => false);

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
    if (!activeRef.current || operation !== operationRef.current) return;

    stopPlayback();
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    playbackSourceRef.current = source;
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
        if (playbackResolveRef.current === resolve) playbackResolveRef.current = null;
        source.disconnect();
        resolve();
      };
      markTiming(diagnostics, "playback_started_at");
      source.start();
    });
    markTiming(diagnostics, "playback_finished_at");
  }, [stopPlayback, transition]);

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
            transition("thinking", { turnId: diagnostics.turnId, phase });
            setSessionNotice("Transcribing your reflection…");
          } else if (phase === "response") {
            setSessionNotice("Preparing a response…");
          } else if (phase === "tts") {
            setSessionNotice("Preparing the voice response…");
          } else if (phase === "restart") {
            setSessionNotice("Listening for your next reflection…");
          }
        },
        transcribe: async (blob) => {
          markTiming(diagnostics, "transcription_started_at");
          const audio = await blobToDataUrl(blob);
          const response = await apiFetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Client-Request-Id": diagnostics.turnId,
            },
            body: JSON.stringify({ audio, language: "en" }),
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
              messages: normalizeMessages(historyRef.current),
              shadowNotes: shadowNotesRef.current,
            }),
            signal: controller.signal,
          });
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
          logVoiceEvent("provider_response", {
            turnId: diagnostics.turnId,
            phase: "tts",
            providerHttpStatus: response.status,
          });
          if (!response.ok) {
            await parseApiResponse(response);
          }

          const contentType = response.headers.get("Content-Type")?.toLowerCase() || "";
          let audio: ArrayBuffer;
          if (contentType.includes("audio/")) {
            audio = await response.arrayBuffer();
          } else {
            const compatibility = await response.json().catch(() => ({})) as {
              audioContent?: string;
            };
            if (!compatibility.audioContent) {
              throw new Error(
                "The voice response could not be generated. The reply is saved in Chat.",
              );
            }
            audio = base64ToArrayBuffer(compatibility.audioContent);
          }
          markTiming(diagnostics, "tts_finished_at");
          return audio;
        },
        play: (audio) => playResponse(audio, operation, diagnostics),
        restartListening: () => beginRecordingRef.current(diagnostics),
        setReady: () => {
          setSessionNotice("Microphone paused.");
          transition("ready", { turnId: diagnostics.turnId });
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

  const processRecording = useCallback(async (blob: Blob, operation: number) => {
    if (!activeRef.current || operation !== operationRef.current) return;
    if (!blob.size) {
      setSessionNotice("I did not catch anything. Please try again.");
      await beginRecordingRef.current();
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      setSessionNotice("That was a little long. Please try a shorter reflection.");
      await beginRecordingRef.current();
      return;
    }

    const diagnostics: VoiceTurnDiagnostics = {
      turnId: crypto.randomUUID(),
      sessionGeneration: currentSessionGenerationRef.current,
      startMode: currentStartModeRef.current,
      timestamps: {},
      marks: {},
    };
    markTiming(diagnostics, "recording_finished_at");
    const checkpoint: VoiceTurnCheckpoint = { blob };
    await processCheckpoint(checkpoint, operation, diagnostics);
  }, [processCheckpoint]);

  const finishTurn = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    const operation = operationRef.current;
    clearRecordingTimer(operation);
    stopVad();
    transition("thinking");
    setSessionNotice("Finishing your thought…");
    try {
      recorder.requestData();
      recorder.stop();
    } catch {
      recorderRef.current = null;
      releaseStream();
      setError("The microphone stopped unexpectedly. Please try again.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
    }
  }, [clearRecordingTimer, releaseStream, stopVad, transition]);

  const beginRecording = useCallback(async (
    restartDiagnostics?: VoiceTurnDiagnostics,
  ): Promise<boolean> => {
    if (!activeRef.current || mutedRef.current) {
      if (activeRef.current) transition("ready");
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
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
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }

    streamRef.current = stream;
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
    const recorderChunks: Blob[] = [];
    recordingStartedAtRef.current = performance.now();
    speechStartedAtRef.current = null;
    lastSpeechAtRef.current = null;
    let recorderSource: MediaStreamAudioSourceNode | null = null;

    recorder.ondataavailable = (event) => {
      if (event.data.size) recorderChunks.push(event.data);
    };
    recorder.onerror = () => {
      discardedRecordersRef.current.add(recorder);
      if (recorderRef.current === recorder) recorderRef.current = null;
      releaseStream(stream, recorderSource);
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
      clearRecordingTimer(operation);
      releaseStream(stream, recorderSource);
      const discard = discardedRecordersRef.current.has(recorder);
      discardedRecordersRef.current.delete(recorder);
      const blob = new Blob(recorderChunks, {
        type: recorderChunks[0]?.type || recorder.mimeType || "audio/webm",
      });
      if (!discard) void processRecording(blob, operation);
    };

    const context = audioContextRef.current;
    if (context && context.state !== "closed") {
      await context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      recorderSource = context.createMediaStreamSource(stream);
      recorderSource.connect(analyser);
      mediaSourceRef.current = recorderSource;
      const samples = new Uint8Array(analyser.fftSize);
      const monitor = () => {
        if (recorderRef.current !== recorder || recorder.state === "inactive") return;
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / samples.length);
        const now = performance.now();
        if (rms >= SPEECH_RMS_THRESHOLD) {
          if (speechStartedAtRef.current === null) {
            speechStartedAtRef.current = now;
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
        }
        vadFrameRef.current = window.requestAnimationFrame(monitor);
      };
      vadFrameRef.current = window.requestAnimationFrame(monitor);
    }

    try {
      recorder.start(250);
      transition("listening", {
        audioContextState: audioContextRef.current?.state || "missing",
        mediaRecorderMimeType: recorder.mimeType || mimeType || "browser-default",
      });
      if (restartDiagnostics) {
        markTiming(restartDiagnostics, "recording_restarted_at");
      }
      recordingTimerOperationRef.current = operation;
      recordingTimerRef.current = window.setTimeout(
        () => finishTurn(),
        MAX_RECORDING_MS,
      );
      return true;
    } catch {
      if (recorderRef.current === recorder) recorderRef.current = null;
      releaseStream(stream, recorderSource);
      setError("Audio recording could not start. Please try again.");
      setErrorCode("connection_failed");
      setRetryPhase("restart");
      transition("error");
      return false;
    }
  }, [
    clearRecordingTimer,
    finishTurn,
    processRecording,
    releaseStream,
    transition,
  ]);
  beginRecordingRef.current = beginRecording;

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
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        discardedRecordersRef.current.add(recorder);
        try {
          recorder.stop();
        } catch {
          // Recorder cleanup continues below.
        }
        releaseStream();
        transition("ready");
      }
      setSessionNotice("Microphone paused.");
    } else if (activeRef.current) {
      setSessionNotice(null);
      void beginRecording();
    }
  }, [beginRecording, releaseStream, transition]);

  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    const hadPlayback = Boolean(playbackSourceRef.current);
    stopPlayback();
    transition("interrupted");
    setSessionNotice("Response stopped. I'm listening again.");
    logVoiceEvent("playback_interrupted", {
      sessionGeneration: currentSessionGenerationRef.current,
    });
    if (!hadPlayback && !mutedRef.current) void beginRecording();
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
      requestControllerRef.current?.abort();
      const recorder = recorderRef.current;
      if (recorder) discardedRecordersRef.current.add(recorder);
      if (recorder?.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Keep the session recoverable while offline.
        }
      }
      releaseStream();
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
  }, [releaseStream, transition]);

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
  }, []);

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
