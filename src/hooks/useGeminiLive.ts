import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GoogleGenAI as GoogleGenAIType,
  LiveConnectConfig,
} from "@google/genai";
import { apiFetch } from "../lib/apiClient";
import { isNativePlatform } from "../lib/native/platform";
import { refreshNativeSubscriptionEntitlement } from "../lib/native/subscriptionSync";
import {
  createIdempotentAsyncAction,
  createInitialHistoryPayload,
  getLiveReconnectDelay,
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
  const stopRequestedRef = useRef(false);
  const startingRef = useRef(false);
  const startRef = useRef<((isReconnect?: boolean) => Promise<void>) | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const endTimerRef = useRef<number | null>(null);
  const failureHandledRef = useRef(false);
  const reservationHandleRef = useRef<string | null>(reservation?.handle ?? null);
  const reservationExpiresAtRef = useRef<string | null>(reservation?.expiresAt ?? null);
  const stopActionRef = useRef<ReturnType<typeof createIdempotentAsyncAction> | null>(null);
  if (!stopActionRef.current) stopActionRef.current = createIdempotentAsyncAction();

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    reservationHandleRef.current = reservation?.handle ?? null;
    reservationExpiresAtRef.current = reservation?.expiresAt ?? null;
  }, [reservation]);

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
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopPlayback();

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
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
      })) {
        setState("listening");
      }
    });
    setState("assistant-speaking");
  }, [getPlaybackInput]);

  const stop = useCallback((nextState: VoiceState = "ended") => {
    return stopActionRef.current!(async () => {
      stopRequestedRef.current = true;
      audioStreamEndedRef.current = signalAudioStreamEnd(
        sessionRef.current,
        audioStreamEndedRef.current,
      );
      suppressPlaybackRef.current = false;
      setState("ending");
      clearTimers();
      finalizeUserTranscript();
      finalizeAssistantTranscript();
      releaseAudio();

      const session = sessionRef.current;
      sessionRef.current = null;
      session?.close();
      setIsMuted(false);
      audioStreamEndedRef.current = true;
      setSessionNotice(null);
      setState(nextState);
    });
  }, [clearTimers, finalizeAssistantTranscript, finalizeUserTranscript, releaseAudio]);

  const handleConnectionFailure = useCallback((
    failedSession: GeminiLiveSession,
    message: string,
  ) => {
    if (stopRequestedRef.current || failureHandledRef.current || sessionRef.current !== failedSession) return;

    failureHandledRef.current = true;
    audioStreamEndedRef.current = signalAudioStreamEnd(failedSession, audioStreamEndedRef.current);
    suppressPlaybackRef.current = false;
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
        if (!stopRequestedRef.current) void startRef.current?.(true);
      }, getLiveReconnectDelay(attempt));
      return;
    }
    setState("error");
    setError(message);
  }, [releaseAudio]);

  const start = useCallback(async (isReconnect = false) => {
    if (startingRef.current || sessionRef.current) return;
    startingRef.current = true;
    if (!isReconnect) reconnectAttemptsRef.current = 0;
    playbackGenerationRef.current += 1;
    audioStreamEndedRef.current = true;
    suppressPlaybackRef.current = false;
    stopRequestedRef.current = false;
    failureHandledRef.current = false;
    setError(null);
    setErrorCode(null);
    setRetryAfterSeconds(null);
    setRetryUntil(null);
    setSessionNotice(null);
    userTranscriptRef.current = "";
    assistantTranscriptRef.current = "";
    userTranscriptFinalizedRef.current = false;
    assistantTranscriptFinalizedRef.current = false;

    if (typeof navigator === "undefined" || !navigator.onLine) {
      setState("offline");
      setError("Reconnect to the internet to start Voice mode.");
      startingRef.current = false;
      return;
    }

    try {
      const activatedAudioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = activatedAudioContext;
      await activatedAudioContext.resume();
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
        setSessionNotice("Your subscription is being refreshed.");
        await refreshNativeSubscriptionEntitlement().catch((syncError) => {
          console.warn("Native subscription refresh did not complete", {
            message: syncError instanceof Error ? syncError.message : "Unknown subscription refresh error.",
          });
        });
        setSessionNotice(null);
      }
      const eligibilityResponse = await apiFetch("/api/live/eligibility", {
        method: "GET",
        headers: reservationHandle
          ? { "X-Voice-Reservation": reservationHandle }
          : undefined,
      });
      const eligibility = (await eligibilityResponse.json().catch(() => ({}))) as VoiceEligibilityResponse;
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
      mediaStreamRef.current = stream;

      setState("connecting");
      const renewingHandle = eligibility.reason === "reservation_resume"
        ? reservationHandleRef.current
        : null;
      const response = await apiFetch(
        "/api/live/token",
        renewingHandle
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reservationHandle: renewingHandle }),
            }
          : { method: "POST" },
      );
      const data = (await response.json().catch(() => ({}))) as LiveTokenResponse;
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
      const client = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
      });
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
        sessionResumption: {},
        historyConfig: {
          initialHistoryInClientContent: true,
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            prefixPaddingMs: 240,
            silenceDurationMs: 1_300,
          },
        },
      };
      let session: GeminiLiveSession;
      session = await client.live.connect({
        model: data.model,
        config: liveConfig,
        callbacks: {
          onopen: () => {
            if (!stopRequestedRef.current) {
              setState("ready");
            }
          },
          onmessage: (message) => {
            if (stopRequestedRef.current) return;
            const serverContent = message.serverContent;
            const inputText = serverContent?.inputTranscription?.text?.trim();
            const outputText = serverContent?.outputTranscription?.text?.trim();

            if (inputText) {
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
              suppressPlaybackRef.current = false;
              stopPlayback();
              setState("interrupted");
            }

            const parts = serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              if (
                part.inlineData?.data &&
                !serverContent?.interrupted &&
                !suppressPlaybackRef.current
              ) {
                void playAudioChunk(part.inlineData.data, part.inlineData.mimeType);
              }
            }

            if (serverContent?.turnComplete) {
              reconnectAttemptsRef.current = 0;
              suppressPlaybackRef.current = false;
              finalizeUserTranscript();
              finalizeAssistantTranscript();
              if (!playbackSourcesRef.current.length) setState("listening");
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

      sessionRef.current = session;
      const initialHistory = createInitialHistoryPayload(history);
      if (initialHistory) session.sendClientContent(initialHistory);

      const audioContext = audioContextRef.current || getAudioContext();
      audioContextRef.current = audioContext;
      if (audioContext.state !== "running") await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;

      const sendPcmAudio = (pcm: Uint8Array) => {
        if (stopRequestedRef.current || isMutedRef.current) return;
        audioStreamEndedRef.current = false;
        session.sendRealtimeInput({
          audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
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

      const maxDuration = getLiveSessionDurationMs(data);
      if (maxDuration > 60_000) {
        noticeTimerRef.current = window.setTimeout(() => {
          setSessionNotice("This reflection is nearly complete. We can continue in a new session.");
        }, maxDuration - 60_000);
      }
      endTimerRef.current = window.setTimeout(() => {
        setSessionNotice("This reflection has ended. Start a new session whenever you are ready.");
        void stop("ended");
      }, maxDuration);

      setState("listening");
    } catch (startError) {
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
      startingRef.current = false;
    }
  }, [finalizeAssistantTranscript, finalizeUserTranscript, handleConnectionFailure, history, onReservationChange, playAudioChunk, releaseAudio, stop, stopPlayback]);

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
      if (document.visibilityState === "hidden" && sessionRef.current) {
        void stop("ended");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [stop]);

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
        if (!isActive && sessionRef.current) void stop("ended");
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
  }, [stop]);

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
