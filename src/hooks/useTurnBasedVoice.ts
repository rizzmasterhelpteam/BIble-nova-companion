import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import type { ConversationMessage, VoiceState } from "../types/live";

type VoiceReservation = { handle: string; expiresAt: string };
type VoiceErrorCode =
  | "subscription_required"
  | "session_active"
  | "daily_limit"
  | "permission_denied"
  | "connection_failed"
  | null;

type TurnBasedVoiceOptions = {
  history: ConversationMessage[];
  shadowNotes: string | null;
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
  onAcceptShadowNotes: (notes: string | null) => void;
  reservation: VoiceReservation | null;
  onReservationChange: (reservation: VoiceReservation | null) => void;
};

type ApiErrorBody = {
  error?: string;
  reason?: Exclude<VoiceErrorCode, null>;
  retryAfterSeconds?: number | null;
};

const RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];
const MAX_RECORDING_MS = 45_000;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const SILENCE_AFTER_SPEECH_MS = 1_100;
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

const createClientReservationHandle = () => {
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
    const error = new Error(data.error || `Voice request failed (${response.status}).`) as Error & ApiErrorBody;
    error.reason = data.reason;
    error.retryAfterSeconds = data.retryAfterSeconds;
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

export function useTurnBasedVoice({
  history,
  shadowNotes,
  onUserTranscript,
  onAssistantTranscript,
  onAcceptShadowNotes,
  reservation,
  onReservationChange,
}: TurnBasedVoiceOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<VoiceErrorCode>(null);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [retryUntil, setRetryUntil] = useState<number | null>(null);

  const historyRef = useRef(history);
  const shadowNotesRef = useRef(shadowNotes);
  const reservationRef = useRef(reservation);
  const activeRef = useRef(false);
  const mutedRef = useRef(false);
  const operationRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const recordingStartedAtRef = useRef(0);
  const speechStartedAtRef = useRef<number | null>(null);
  const lastSpeechAtRef = useRef<number | null>(null);
  const vadFrameRef = useRef<number | null>(null);
  const recordingTimerRef = useRef<number | null>(null);
  const sessionTimerRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playbackSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const playbackResolveRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    shadowNotesRef.current = shadowNotes;
  }, [shadowNotes]);
  useEffect(() => {
    reservationRef.current = reservation;
  }, [reservation]);

  const clearRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current !== null) {
      window.clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const stopVad = useCallback(() => {
    if (vadFrameRef.current !== null) {
      window.cancelAnimationFrame(vadFrameRef.current);
      vadFrameRef.current = null;
    }
    mediaSourceRef.current?.disconnect();
    mediaSourceRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    stopVad();
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
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextConstructor) return;
    if (!audioContextRef.current || audioContextRef.current.state === "closed") {
      audioContextRef.current = new AudioContextConstructor();
    }
    void audioContextRef.current.resume().catch(() => undefined);
  }, []);

  const releaseReservation = useCallback(async () => {
    const current = reservationRef.current;
    reservationRef.current = null;
    onReservationChange(null);
    if (!current?.handle) return;
    await apiFetch("/api/voice/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "release", reservationHandle: current.handle }),
    }).catch(() => undefined);
  }, [onReservationChange]);

  const stop = useCallback(async (finalState: VoiceState = "ended") => {
    activeRef.current = false;
    operationRef.current += 1;
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    clearRecordingTimer();
    if (sessionTimerRef.current !== null) {
      window.clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    discardRecordingRef.current = true;
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder?.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        // Continue cleanup if the recorder stopped concurrently.
      }
    }
    chunksRef.current = [];
    releaseStream();
    stopPlayback();
    setState(finalState === "ended" ? "ending" : finalState);
    await releaseReservation();
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
    setIsMuted(false);
    mutedRef.current = false;
    setState(finalState);
  }, [clearRecordingTimer, releaseReservation, releaseStream, stopPlayback]);

  const beginRecordingRef = useRef<() => Promise<void>>(async () => undefined);

  const playResponse = useCallback(async (audioContent: string, operation: number) => {
    const context = audioContextRef.current;
    if (!context || context.state === "closed") {
      throw new Error("Audio playback is unavailable. The reply is saved in Chat.");
    }
    await context.resume();
    const audioBuffer = await context.decodeAudioData(base64ToArrayBuffer(audioContent));
    if (!activeRef.current || operation !== operationRef.current) return;
    stopPlayback();
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    playbackSourceRef.current = source;
    setState("assistant-speaking");
    await new Promise<void>((resolve) => {
      playbackResolveRef.current = resolve;
      source.onended = () => {
        if (playbackSourceRef.current === source) playbackSourceRef.current = null;
        if (playbackResolveRef.current === resolve) playbackResolveRef.current = null;
        source.disconnect();
        resolve();
      };
      source.start();
    });
  }, [stopPlayback]);

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

    setState("thinking");
    setSessionNotice("Transcribing your reflection…");
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const audio = await blobToDataUrl(blob);
      const transcriptionResponse = await apiFetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio, language: "en" }),
        signal: controller.signal,
      });
      const transcription = await parseApiResponse<{ text?: string }>(transcriptionResponse);
      const text = transcription.text?.trim();
      if (!text) throw new Error("No speech was captured. Please try again.");
      if (!activeRef.current || operation !== operationRef.current) return;

      onUserTranscript(text);
      const nextHistory = [
        ...normalizeMessages(historyRef.current),
        { role: "user" as const, content: text },
      ];
      historyRef.current = [
        ...historyRef.current,
        { id: crypto.randomUUID(), role: "user", content: text, source: "voice" },
      ];
      setSessionNotice("Preparing a response…");

      const chatResponse = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextHistory,
          shadowNotes: shadowNotesRef.current,
        }),
        signal: controller.signal,
      });
      const chat = await parseApiResponse<{
        message?: string;
        shadowNotes?: string | null;
      }>(chatResponse);
      const assistantText = chat.message?.trim();
      if (!assistantText) throw new Error("The reflection response was empty.");
      if (typeof chat.shadowNotes === "string" && chat.shadowNotes.trim()) {
        shadowNotesRef.current = chat.shadowNotes;
        onAcceptShadowNotes(chat.shadowNotes);
      }
      onAssistantTranscript(assistantText);
      historyRef.current = [
        ...historyRef.current,
        { id: crypto.randomUUID(), role: "ai", content: assistantText, source: "voice" },
      ];
      if (!activeRef.current || operation !== operationRef.current) return;

      setSessionNotice("Preparing the voice response…");
      const speechResponse = await apiFetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: assistantText }),
        signal: controller.signal,
      });
      const speech = await parseApiResponse<{ audioContent?: string }>(speechResponse);
      if (!speech.audioContent) {
        throw new Error("The voice response could not be generated. The reply is saved in Chat.");
      }
      setSessionNotice(null);
      await playResponse(speech.audioContent, operation);
      if (activeRef.current && operation === operationRef.current && !mutedRef.current) {
        await beginRecordingRef.current();
      } else if (activeRef.current) {
        setState("ready");
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      const message = caught instanceof Error ? caught.message : "Voice processing failed.";
      setError(message);
      setErrorCode("connection_failed");
      setSessionNotice("You can retry this turn or continue in Chat.");
      setState("error");
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [
    onAcceptShadowNotes,
    onAssistantTranscript,
    onUserTranscript,
    playResponse,
  ]);

  const finishTurn = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    clearRecordingTimer();
    stopVad();
    setState("thinking");
    setSessionNotice("Finishing your thought…");
    try {
      recorder.requestData();
      recorder.stop();
    } catch {
      recorderRef.current = null;
      releaseStream();
      setError("The microphone stopped unexpectedly. Please try again.");
      setErrorCode("connection_failed");
      setState("error");
    }
  }, [clearRecordingTimer, releaseStream, stopVad]);

  const beginRecording = useCallback(async () => {
    if (!activeRef.current || mutedRef.current) {
      if (activeRef.current) setState("ready");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Microphone recording is unavailable on this device.");
      setErrorCode("connection_failed");
      setState("error");
      return;
    }

    const operation = operationRef.current;
    setState("requesting-permission");
    setError(null);
    setErrorCode(null);
    setSessionNotice(null);
    let stream: MediaStream;
    try {
      if (isNativePlatform() && getNativePlatform() === "android") {
        const { SpeechRecognition } = await import("@capgo/capacitor-speech-recognition");
        const current = await SpeechRecognition.checkPermissions();
        if (current.speechRecognition !== "granted") {
          const requested = await SpeechRecognition.requestPermissions();
          if (requested.speechRecognition !== "granted") {
            throw new DOMException("Microphone permission denied.", "NotAllowedError");
          }
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
    } catch (caught) {
      const name = caught instanceof Error ? caught.name.toLowerCase() : "";
      const denied = name.includes("notallowed") || name.includes("permission");
      setError(denied
        ? "Microphone access was denied. Allow it in Android settings and try again."
        : "The microphone could not start. Please try again.");
      setErrorCode(denied ? "permission_denied" : "connection_failed");
      setState(denied ? "permission-denied" : "error");
      return;
    }
    if (!activeRef.current || operation !== operationRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    const mimeType = getRecordingMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream();
      setError("Audio recording could not start on this device.");
      setErrorCode("connection_failed");
      setState("error");
      return;
    }

    recorderRef.current = recorder;
    chunksRef.current = [];
    discardRecordingRef.current = false;
    recordingStartedAtRef.current = performance.now();
    speechStartedAtRef.current = null;
    lastSpeechAtRef.current = null;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      discardRecordingRef.current = true;
      recorderRef.current = null;
      releaseStream();
      setError("Microphone recording failed. Please try again.");
      setErrorCode("connection_failed");
      setState("error");
    };
    recorder.onstop = () => {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
      if (recorderRef.current === recorder) recorderRef.current = null;
      clearRecordingTimer();
      stopVad();
      releaseStream();
      const discard = discardRecordingRef.current;
      discardRecordingRef.current = false;
      const blob = new Blob(chunksRef.current, {
        type: chunksRef.current[0]?.type || recorder.mimeType || "audio/webm",
      });
      chunksRef.current = [];
      if (!discard) void processRecording(blob, operation);
    };

    const context = audioContextRef.current;
    if (context && context.state !== "closed") {
      await context.resume().catch(() => undefined);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      mediaSourceRef.current = source;
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
            setState("user-speaking");
          }
          lastSpeechAtRef.current = now;
        } else if (speechStartedAtRef.current !== null) {
          const speechDuration = now - speechStartedAtRef.current;
          const silenceDuration = now - (lastSpeechAtRef.current || now);
          if (speechDuration >= MIN_SPEECH_MS && silenceDuration >= SILENCE_AFTER_SPEECH_MS) {
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
      setState("listening");
      recordingTimerRef.current = window.setTimeout(() => finishTurn(), MAX_RECORDING_MS);
    } catch {
      recorderRef.current = null;
      releaseStream();
      setError("Audio recording could not start. Please try again.");
      setErrorCode("connection_failed");
      setState("error");
    }
  }, [clearRecordingTimer, finishTurn, processRecording, releaseStream, stopVad]);
  beginRecordingRef.current = beginRecording;

  const start = useCallback(async () => {
    if (activeRef.current) {
      primeAudioForUserGesture();
      await beginRecording();
      return;
    }
    if (!navigator.onLine) {
      setError("Reconnect to the internet and try Voice again.");
      setErrorCode("connection_failed");
      setState("offline");
      return;
    }
    primeAudioForUserGesture();
    activeRef.current = true;
    operationRef.current += 1;
    const operation = operationRef.current;
    setState("connecting");
    setError(null);
    setErrorCode(null);
    setRetryUntil(null);
    setSessionNotice("Confirming premium access…");
    try {
      const requestedHandle = reservationRef.current?.handle || createClientReservationHandle();
      const requestSession = () => apiFetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "start",
            reservationHandle: requestedHandle,
          }),
        });
      let response = await requestSession();
      if (response.status === 403 && isNativePlatform() && getNativePlatform() === "android") {
        setSessionNotice("Rechecking your Google Play premium access…");
        const { refreshNativeSubscriptionEntitlement } = await import("../lib/native/subscriptionSync");
        if (await refreshNativeSubscriptionEntitlement().catch(() => false)) {
          response = await requestSession();
        }
      }
      const session = await parseApiResponse<{
        reservationHandle: string;
        reservationExpiresAt: string;
        remainingSeconds?: number;
      }>(response);
      if (!activeRef.current || operation !== operationRef.current) {
        await apiFetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "release",
            reservationHandle: session.reservationHandle,
          }),
        }).catch(() => undefined);
        return;
      }
      const nextReservation = {
        handle: session.reservationHandle,
        expiresAt: session.reservationExpiresAt,
      };
      reservationRef.current = nextReservation;
      onReservationChange(nextReservation);
      const remainingMs = Math.max(1_000, Date.parse(nextReservation.expiresAt) - Date.now());
      sessionTimerRef.current = window.setTimeout(() => {
        setSessionNotice("This Voice reflection has reached its session limit.");
        void stop("ended");
      }, remainingMs);
      setSessionNotice(null);
      await beginRecording();
    } catch (caught) {
      if (!activeRef.current || operation !== operationRef.current) return;
      activeRef.current = false;
      const apiError = caught as Error & ApiErrorBody;
      const message = apiError.message || "Voice could not start.";
      setError(message);
      setErrorCode(apiError.reason || "connection_failed");
      if (apiError.retryAfterSeconds) {
        setRetryUntil(Date.now() + apiError.retryAfterSeconds * 1_000);
      }
      setState(apiError.reason === "subscription_required" ? "error" : "error");
    }
  }, [
    beginRecording,
    onReservationChange,
    primeAudioForUserGesture,
    stop,
  ]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setIsMuted(nextMuted);
    if (nextMuted) {
      discardRecordingRef.current = true;
      const recorder = recorderRef.current;
      if (recorder?.state !== "inactive") recorder.stop();
      releaseStream();
      setState("ready");
      setSessionNotice("Microphone paused.");
    } else if (activeRef.current) {
      setSessionNotice(null);
      void beginRecording();
    }
  }, [beginRecording, releaseStream]);

  const interrupt = useCallback(() => {
    if (!activeRef.current) return;
    const hadPlayback = Boolean(playbackSourceRef.current);
    stopPlayback();
    setState("interrupted");
    setSessionNotice("Response stopped. I’m listening again.");
    if (!hadPlayback && !mutedRef.current) void beginRecording();
  }, [beginRecording, stopPlayback]);

  const retry = useCallback(async () => {
    if (activeRef.current) {
      setError(null);
      setErrorCode(null);
      setSessionNotice(null);
      await beginRecording();
      return;
    }
    await start();
  }, [beginRecording, start]);

  useEffect(() => () => {
    void stop("ended");
  }, [stop]);

  return {
    state,
    error,
    errorCode,
    sessionNotice,
    isMuted,
    retryUntil,
    start,
    retry,
    stop,
    finishTurn,
    toggleMute,
    interrupt,
    primeAudioForUserGesture,
  };
}
