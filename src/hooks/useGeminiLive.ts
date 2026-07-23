import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GoogleGenAI as GoogleGenAIType,
  LiveConnectConfig,
} from "@google/genai";
import { apiFetch } from "../lib/apiClient";
import { isNativePlatform } from "../lib/native/platform";
import {
  createInitialHistoryPayload,
  getLiveReconnectDelay,
  mergeLiveTranscript,
  shouldReconnectLiveSession,
  shouldResumeListeningAfterPlayback,
  signalAudioStreamEnd,
} from "../lib/liveProtocol";
import type { ConversationMessage, VoiceState } from "../types/live";

type LiveTokenResponse = {
  token?: string;
  model?: string;
  maxMinutes?: number;
  expiresAt?: string;
  leaseId?: string;
  error?: string;
};

type UseGeminiLiveOptions = {
  history: ConversationMessage[];
  onUserTranscript: (text: string) => void;
  onAssistantTranscript: (text: string) => void;
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
  return new AudioContextConstructor({ sampleRate: INPUT_SAMPLE_RATE });
};

export function useGeminiLive({ history, onUserTranscript, onAssistantTranscript }: UseGeminiLiveOptions) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [userTranscript, setUserTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const isMutedRef = useRef(false);

  const sessionRef = useRef<GeminiLiveSession | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorNodeRef = useRef<ScriptProcessorNode | null>(null);
  const muteGainRef = useRef<GainNode | null>(null);
  const playbackSourcesRef = useRef<AudioBufferSourceNode[]>([]);
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
  const leaseIdRef = useRef<string | null>(null);
  const failureHandledRef = useRef(false);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  const clearTimers = useCallback(() => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    if (endTimerRef.current !== null) window.clearTimeout(endTimerRef.current);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    noticeTimerRef.current = null;
    endTimerRef.current = null;
    reconnectTimerRef.current = null;
  }, []);

  const stopPlayback = useCallback(() => {
    playbackSourcesRef.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        // The source may already have ended.
      }
      source.disconnect();
    });
    playbackSourcesRef.current = [];
    nextPlaybackTimeRef.current = 0;
  }, []);

  const releaseAudio = useCallback(() => {
    processorNodeRef.current?.disconnect();
    sourceNodeRef.current?.disconnect();
    muteGainRef.current?.disconnect();
    processorNodeRef.current = null;
    sourceNodeRef.current = null;
    muteGainRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    stopPlayback();

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== "closed") {
      void audioContext.close().catch(() => undefined);
    }
  }, [stopPlayback]);

  const releaseLease = useCallback(() => {
    const leaseId = leaseIdRef.current;
    leaseIdRef.current = null;
    if (!leaseId) return Promise.resolve();
    return apiFetch("/api/live/session", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leaseId }),
    }).then(() => undefined).catch(() => undefined);
  }, []);

  const finalizeUserTranscript = useCallback(() => {
    const finalText = userTranscriptRef.current.trim();
    if (!finalText || userTranscriptFinalizedRef.current) return;
    userTranscriptFinalizedRef.current = true;
    onUserTranscript(finalText);
    setUserTranscript("");
    userTranscriptRef.current = "";
  }, [onUserTranscript]);

  const finalizeAssistantTranscript = useCallback(() => {
    const finalText = assistantTranscriptRef.current.trim();
    if (!finalText || assistantTranscriptFinalizedRef.current) return;
    assistantTranscriptFinalizedRef.current = true;
    onAssistantTranscript(finalText);
    setAssistantTranscript("");
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
    source.connect(audioContext.destination);

    const startAt = Math.max(audioContext.currentTime, nextPlaybackTimeRef.current);
    source.start(startAt);
    nextPlaybackTimeRef.current = startAt + buffer.duration;
    playbackSourcesRef.current.push(source);
    source.addEventListener("ended", () => {
      playbackSourcesRef.current = playbackSourcesRef.current.filter((item) => item !== source);
      if (shouldResumeListeningAfterPlayback({
        playbackGeneration,
        currentGeneration: playbackGenerationRef.current,
        stopRequested: stopRequestedRef.current,
        remainingSources: playbackSourcesRef.current.length,
      })) {
        setState("listening");
      }
    });
    setState("assistant-speaking");
  }, []);

  const stop = useCallback(async (nextState: VoiceState = "ended") => {
    stopRequestedRef.current = true;
    playbackGenerationRef.current += 1;
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
    void releaseLease();
    setIsMuted(false);
    audioStreamEndedRef.current = true;
    setSessionNotice(null);
    setState(nextState);
  }, [clearTimers, finalizeAssistantTranscript, finalizeUserTranscript, releaseAudio, releaseLease]);

  const handleConnectionFailure = useCallback((
    failedSession: GeminiLiveSession,
    message: string,
  ) => {
    if (stopRequestedRef.current || failureHandledRef.current || sessionRef.current !== failedSession) return;

    failureHandledRef.current = true;
    playbackGenerationRef.current += 1;
    audioStreamEndedRef.current = signalAudioStreamEnd(failedSession, audioStreamEndedRef.current);
    suppressPlaybackRef.current = false;
    releaseAudio();
    sessionRef.current = null;
    try {
      failedSession.close();
    } catch {
      // The transport may already be closed.
    }
    const leaseRelease = releaseLease();

    if (shouldReconnectLiveSession(reconnectAttemptsRef.current, MAX_RECONNECT_ATTEMPTS)) {
      reconnectAttemptsRef.current += 1;
      const attempt = reconnectAttemptsRef.current;
      setState("reconnecting");
      setError(null);
      void leaseRelease.finally(() => {
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          failureHandledRef.current = false;
          if (!stopRequestedRef.current) void startRef.current?.(true);
        }, getLiveReconnectDelay(attempt));
      });
      return;
    }
    setState("error");
    setError(message);
  }, [releaseAudio, releaseLease]);

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
    setSessionNotice(null);
    setUserTranscript("");
    setAssistantTranscript("");
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
      setState("requesting-permission");
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Voice is not supported on this device.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      mediaStreamRef.current = stream;

      setState("connecting");
      const response = await apiFetch("/api/live/token", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as LiveTokenResponse;
      if (!response.ok || !data.token || !data.model) {
        throw new Error(data.error || "Voice is temporarily unavailable. You can continue in Chat.");
      }
      if (!data.leaseId) throw new Error("Voice session protection is unavailable.");
      leaseIdRef.current = data.leaseId;

      const { GoogleGenAI, Modality } = await import("@google/genai");
      const client = new GoogleGenAI({
        apiKey: data.token,
        httpOptions: { apiVersion: "v1alpha" },
      });
      const liveConfig: Gemini31LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
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
              reconnectAttemptsRef.current = 0;
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
              setUserTranscript(userTranscriptRef.current);
              setState("user-speaking");
              if (serverContent?.inputTranscription?.finished) {
                finalizeUserTranscript();
                setState("thinking");
              }
            }

            if (outputText) {
              assistantTranscriptFinalizedRef.current = false;
              assistantTranscriptRef.current = mergeLiveTranscript(assistantTranscriptRef.current, outputText);
              setAssistantTranscript(assistantTranscriptRef.current);
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
              suppressPlaybackRef.current = false;
              finalizeUserTranscript();
              finalizeAssistantTranscript();
              if (!playbackSourcesRef.current.length) setState("listening");
            }
          },
          onerror: () => handleConnectionFailure(
            session,
            "Voice is temporarily unavailable. You can continue in Chat.",
          ),
          onclose: () => {
            handleConnectionFailure(
              session,
              "The voice connection ended. You can try again or continue in Chat.",
            );
          },
        },
      });

      sessionRef.current = session;
      const initialHistory = createInitialHistoryPayload(history);
      if (initialHistory) session.sendClientContent(initialHistory);

      const audioContext = getAudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      const muteGain = audioContext.createGain();
      muteGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        if (stopRequestedRef.current || isMutedRef.current) return;
        audioStreamEndedRef.current = false;
        const channel = event.inputBuffer.getChannelData(0);
        const pcm = floatToPcm16(resample(channel, event.inputBuffer.sampleRate, INPUT_SAMPLE_RATE));
        session.sendRealtimeInput({
          audio: { data: bytesToBase64(pcm), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
        });
      };
      source.connect(processor);
      processor.connect(muteGain);
      muteGain.connect(audioContext.destination);
      sourceNodeRef.current = source;
      processorNodeRef.current = processor;
      muteGainRef.current = muteGain;

      const maxMinutes = Math.max(1, Math.min(15, Number(data.maxMinutes || 10)));
      const maxDuration = maxMinutes * 60 * 1000;
      noticeTimerRef.current = window.setTimeout(() => {
        setSessionNotice("This reflection is nearly complete. We can continue in a new session.");
      }, Math.max(30_000, maxDuration - 60_000));
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
      void releaseLease();
      const message = startError instanceof Error ? startError.message : "Voice could not start.";
      if (message.toLowerCase().includes("permission") || message.toLowerCase().includes("notallowed")) {
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
  }, [finalizeAssistantTranscript, finalizeUserTranscript, handleConnectionFailure, history, playAudioChunk, releaseAudio, releaseLease, stop, stopPlayback]);

  useEffect(() => {
    startRef.current = start;
  }, [start]);

  const toggleMute = useCallback(() => {
    setIsMuted((current) => {
      const nextMuted = !current;
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
    userTranscript,
    assistantTranscript,
    isMuted,
    sessionNotice,
    start,
    stop,
    toggleMute,
    interrupt,
  };
}
