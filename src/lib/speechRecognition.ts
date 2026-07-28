import { SpeechRecognition as NativeSpeechRecognition } from "@capgo/capacitor-speech-recognition";
import type { PluginListenerHandle } from "@capacitor/core";
import { apiFetch } from "./apiClient";
import { getNativePlatform, isNativePlatform } from "./native/platform";

type SpeechRecognitionCallbacks = {
  onTranscript: (text: string) => void;
  onListeningChange: (isListening: boolean) => void;
  onProcessingChange: (isProcessing: boolean) => void;
  onNotice?: (message: string) => void;
  onError: (message: string) => void;
  canUseWebFallback?: () => boolean;
};

export type RecognitionMode = "web" | "native" | "unsupported";

export const SPEECH_UNAVAILABLE_MESSAGE = "Speech-to-text is unavailable. You can still type.";

export type SpeechDiagnostics = {
  platform: string;
  nativeSpeechPluginAvailable: boolean | null;
  permissionResult: string | null;
  selectedSpeechMode: RecognitionMode;
  webRecordingAvailable: boolean;
  fallbackReady: boolean;
  lastStartError: string | null;
};

export type SpeechRecognitionSession = {
  start: (initialText?: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  isSupported: () => Promise<boolean>;
  getMode: () => Promise<RecognitionMode>;
  getDiagnostics: () => Promise<SpeechDiagnostics>;
};

interface MediaRecorderOptionsWithMimeType extends MediaRecorderOptions {
  mimeType?: string;
}

const WEB_RECORDING_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const MAX_WEB_RECORDING_MS = 60_000;
const MAX_WEB_AUDIO_BYTES = 5 * 1024 * 1024;

const isAndroidNativeSpeech = () =>
  isNativePlatform() && getNativePlatform() === "android";

const isWebRecordingSupported = () =>
  Boolean(
    typeof navigator !== "undefined" &&
      navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined",
  );

const normalizeTranscript = (text: string) => text.trim().replace(/\s+/g, " ");

const mergeTranscript = (prefix: string, transcript: string) => {
  const normalizedTranscript = normalizeTranscript(transcript);
  const normalizedPrefix = normalizeTranscript(prefix);

  if (!normalizedPrefix) return normalizedTranscript;
  if (!normalizedTranscript) return normalizedPrefix;

  return `${normalizedPrefix} ${normalizedTranscript}`;
};

const removeNativeListener = async (listener: PluginListenerHandle | null) => {
  if (!listener) return;
  await listener.remove().catch(() => undefined);
};

const readBlobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the recorded audio."));
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Recorded audio could not be prepared for transcription."));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });

const getSupportedRecordingMimeType = () => {
  for (const mimeType of WEB_RECORDING_MIME_TYPES) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return "";
};

export const createSpeechRecognitionSession = ({
  onTranscript,
  onListeningChange,
  onProcessingChange,
  onNotice,
  onError,
  canUseWebFallback,
}: SpeechRecognitionCallbacks): SpeechRecognitionSession => {
  let baseText = "";
  let isDestroyed = false;
  let activeMode: RecognitionMode | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaChunks: Blob[] = [];
  let stopWebRecordingPromise: Promise<void> | null = null;
  let nativePartialResultsListener: PluginListenerHandle | null = null;
  let nativeSegmentResultsListener: PluginListenerHandle | null = null;
  let nativeListeningStateListener: PluginListenerHandle | null = null;
  let latestNativeTranscript = "";
  let nativeTranscriptCommitted = false;
  let nativeFinalizing = false;
  let recordingLimitTimer: number | null = null;
  let nativeSpeechPluginAvailable: boolean | null = null;
  let permissionResult: string | null = null;
  let lastStartError: string | null = null;

  const emitTranscript = (text: string) => {
    if (!isDestroyed) {
      onTranscript(text);
    }
  };

  const emitListeningChange = (isListening: boolean) => {
    if (!isDestroyed) {
      onListeningChange(isListening);
    }
  };

  const emitProcessingChange = (isProcessing: boolean) => {
    if (!isDestroyed) {
      onProcessingChange(isProcessing);
    }
  };

  const emitError = (message: string) => {
    if (!isDestroyed) {
      onError(message);
    }
  };

  const clearRecordingLimitTimer = () => {
    if (recordingLimitTimer !== null) {
      window.clearTimeout(recordingLimitTimer);
      recordingLimitTimer = null;
    }
  };

  const stopNativeRecognition = async (commitTranscript = false, stopRecognizer = true) => {
    if (nativeFinalizing) return;
    nativeFinalizing = true;
    if (stopRecognizer) {
      await NativeSpeechRecognition.forceStop({ timeout: 1_200 }).catch(() =>
        NativeSpeechRecognition.stop().catch(() => undefined),
      );
      const cached = await NativeSpeechRecognition.getLastPartialResult().catch(() => null);
      if (cached?.available && cached.text) {
        latestNativeTranscript = normalizeTranscript(cached.text);
      }
    }
    if (commitTranscript && !nativeTranscriptCommitted) {
      nativeTranscriptCommitted = true;
      if (latestNativeTranscript) {
        emitTranscript(mergeTranscript(baseText, latestNativeTranscript));
      } else {
        emitError("No speech was captured. Please try again.");
      }
    }
    await removeNativeListener(nativePartialResultsListener);
    await removeNativeListener(nativeSegmentResultsListener);
    await removeNativeListener(nativeListeningStateListener);
    nativePartialResultsListener = null;
    nativeSegmentResultsListener = null;
    nativeListeningStateListener = null;
    activeMode = null;
    emitListeningChange(false);
    nativeFinalizing = false;
  };

  const resolveRecognitionMode = async (): Promise<RecognitionMode> => {
    if (!isAndroidNativeSpeech()) {
      return isWebRecordingSupported() ? "web" : "unsupported";
    }

    try {
      const { available } = await NativeSpeechRecognition.available();
      nativeSpeechPluginAvailable = Boolean(available);
      return available ? "native" : isWebRecordingSupported() ? "web" : "unsupported";
    } catch {
      nativeSpeechPluginAvailable = false;
      return isWebRecordingSupported() ? "web" : "unsupported";
    }
  };

  const releaseMediaStream = () => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  };

  const discardWebRecording = () => {
    clearRecordingLimitTimer();
    const currentRecorder = mediaRecorder;
    mediaRecorder = null;
    stopWebRecordingPromise = null;

    if (currentRecorder) {
      currentRecorder.ondataavailable = null;
      currentRecorder.onerror = null;
      currentRecorder.onstart = null;
      currentRecorder.onstop = null;

      if (currentRecorder.state !== "inactive") {
        currentRecorder.stop();
      }
    }

    mediaChunks = [];
    releaseMediaStream();
    emitListeningChange(false);
    emitProcessingChange(false);
  };

  const stopWebRecording = async () => {
    clearRecordingLimitTimer();
    if (stopWebRecordingPromise) {
      return stopWebRecordingPromise;
    }

    if (!mediaRecorder) return;

    const currentRecorder = mediaRecorder;
    mediaRecorder = null;

    stopWebRecordingPromise = new Promise<void>((resolve) => {
      const finalize = async () => {
        currentRecorder.ondataavailable = null;
        currentRecorder.onerror = null;
        currentRecorder.onstart = null;
        currentRecorder.onstop = null;

        releaseMediaStream();
        const blobType = mediaChunks[0]?.type || currentRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(mediaChunks, { type: blobType });
        mediaChunks = [];

        if (!audioBlob.size) {
          emitListeningChange(false);
          emitError("No speech was captured.");
          resolve();
          return;
        }

        if (audioBlob.size > MAX_WEB_AUDIO_BYTES) {
          emitListeningChange(false);
          emitError("That recording was too long. Please try a shorter message.");
          resolve();
          return;
        }

        emitListeningChange(false);
        emitProcessingChange(true);

        try {
          const audio = await readBlobAsDataUrl(audioBlob);
          const response = await apiFetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              audio,
              language: navigator.language?.slice(0, 2) || "en",
            }),
          });

          const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
          if (!response.ok) {
            throw new Error(data.error || "Speech transcription failed.");
          }

          emitTranscript(mergeTranscript(baseText, data.text || ""));
        } catch (error) {
          emitError(error instanceof Error ? error.message : "Speech transcription failed.");
        } finally {
          emitProcessingChange(false);
          resolve();
        }
      };

      currentRecorder.onstop = () => {
        void finalize();
      };

      if (currentRecorder.state === "inactive") {
        void finalize();
        return;
      }

      currentRecorder.stop();
    }).finally(() => {
      stopWebRecordingPromise = null;
    });

    await stopWebRecordingPromise;
  };

  const startWebRecording = async () => {
    if (!isWebRecordingSupported()) {
      throw new Error("Speech recognition is not available in this browser.");
    }

    await stopWebRecording();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      const message = error instanceof Error ? error.name.toLowerCase() : "";
      if (message.includes("notallowed") || message.includes("permission")) {
        throw new Error("Microphone access was denied. Enable it in your device settings or type your message.");
      }
      throw error;
    }

    mediaStream = stream;
    const mimeType = getSupportedRecordingMimeType();
    const recorderOptions: MediaRecorderOptionsWithMimeType = mimeType ? { mimeType } : {};
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, recorderOptions);
    } catch (error) {
      releaseMediaStream();
      throw error;
    }
    mediaRecorder = recorder;
    mediaChunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) mediaChunks.push(event.data);
    };
    recorder.onerror = () => {
      clearRecordingLimitTimer();
      releaseMediaStream();
      mediaRecorder = null;
      mediaChunks = [];
      emitListeningChange(false);
      emitError("Microphone recording failed.");
    };
    recorder.onstart = () => {
      emitListeningChange(true);
      recordingLimitTimer = window.setTimeout(() => {
        recordingLimitTimer = null;
        onNotice?.("Recording limit reached. Transcribing now.");
        void stopWebRecording();
      }, MAX_WEB_RECORDING_MS);
    };

    try {
      recorder.start();
    } catch (error) {
      discardWebRecording();
      throw error;
    }
    activeMode = "web";
  };

  const canStartWebRecording = () =>
    isWebRecordingSupported() && (canUseWebFallback ? canUseWebFallback() : true);

  const cleanupFailedStart = async () => {
    clearRecordingLimitTimer();
    if (
      activeMode === "native" ||
      nativePartialResultsListener ||
      nativeSegmentResultsListener ||
      nativeListeningStateListener
    ) {
      await stopNativeRecognition(false);
    }
    if (mediaRecorder) discardWebRecording();
    else releaseMediaStream();
    activeMode = null;
    emitListeningChange(false);
    emitProcessingChange(false);
  };

  const getDiagnostics = async (): Promise<SpeechDiagnostics> => {
    const selectedSpeechMode = await resolveRecognitionMode();
    if (isAndroidNativeSpeech()) {
      try {
        const permissions = await NativeSpeechRecognition.checkPermissions();
        permissionResult = permissions.speechRecognition;
      } catch {
        // Permission state remains unknown until the next request/check.
      }
    }
    const webRecordingAvailable = isWebRecordingSupported();
    return {
      platform: isNativePlatform() ? getNativePlatform() : "web",
      nativeSpeechPluginAvailable,
      permissionResult,
      selectedSpeechMode,
      webRecordingAvailable,
      fallbackReady: webRecordingAvailable && (canUseWebFallback ? canUseWebFallback() : true),
      lastStartError,
    };
  };

  return {
    getMode: resolveRecognitionMode,
    isSupported: async () => (await resolveRecognitionMode()) !== "unsupported",
    getDiagnostics,
    start: async (initialText = "") => {
      baseText = initialText;
      lastStartError = null;
      try {
        activeMode = await resolveRecognitionMode();

        if (activeMode === "unsupported") {
          throw new Error(SPEECH_UNAVAILABLE_MESSAGE);
        }

        if (activeMode === "native") {
          const { available } = await NativeSpeechRecognition.available();
          nativeSpeechPluginAvailable = Boolean(available);
          if (!available) {
            throw new Error(SPEECH_UNAVAILABLE_MESSAGE);
          }

          const { speechRecognition } = await NativeSpeechRecognition.requestPermissions();
          permissionResult = speechRecognition;
          if (speechRecognition !== "granted") {
            throw new Error("Microphone access was denied. Enable it in Android settings or type your message.");
          }

          await stopNativeRecognition();
          activeMode = "native";
          latestNativeTranscript = "";
          nativeTranscriptCommitted = false;

          nativePartialResultsListener = await NativeSpeechRecognition.addListener(
            "partialResults",
            ({ matches }) => {
              latestNativeTranscript = normalizeTranscript(matches?.[0] || "");
              emitTranscript(mergeTranscript(baseText, latestNativeTranscript));
            },
          );

          nativeSegmentResultsListener = await NativeSpeechRecognition.addListener(
            "segmentResults",
            ({ matches }) => {
              const finalText = normalizeTranscript(matches?.[0] || "");
              if (!finalText) return;
              latestNativeTranscript = finalText;
              emitTranscript(mergeTranscript(baseText, finalText));
            },
          );

          nativeListeningStateListener = await NativeSpeechRecognition.addListener(
            "listeningState",
            ({ status, state }) => {
              const currentStatus = state || status;
              const listening = currentStatus === "started";
              emitListeningChange(listening);
              if (currentStatus === "stopped" && activeMode === "native" && !nativeFinalizing) {
                void stopNativeRecognition(true, false);
              }
            },
          );

          try {
            await NativeSpeechRecognition.start({
              language: navigator.language || "en-US",
              maxResults: 1,
              partialResults: true,
              popup: false,
            });
          } catch (error) {
            await stopNativeRecognition();
            const message = error instanceof Error ? error.message : "Speech recognition could not start.";
            lastStartError = message;
            const normalizedMessage = message.toLowerCase();
            if (normalizedMessage.includes("permission") || normalizedMessage.includes("denied") || normalizedMessage.includes("notallowed")) {
              throw new Error("Microphone access was denied. Enable it in Android settings or type your message.");
            }
            if (canStartWebRecording()) {
              onNotice?.("Native speech recognition was unavailable. Using server transcription.");
              await startWebRecording();
              return;
            }
            throw new Error(SPEECH_UNAVAILABLE_MESSAGE);
          }

          emitListeningChange(true);
          return;
        }

        if (!canStartWebRecording()) {
          throw new Error(SPEECH_UNAVAILABLE_MESSAGE);
        }
        await startWebRecording();
      } catch (error) {
        lastStartError = error instanceof Error ? error.message : String(error);
        await cleanupFailedStart();
        throw error;
      }
    },
    stop: async () => {
      if (activeMode === "native") {
        await stopNativeRecognition(true);
        emitListeningChange(false);
        activeMode = null;
        return;
      }

      if (!mediaRecorder) {
        emitListeningChange(false);
        activeMode = null;
        return;
      }

      await stopWebRecording();
      activeMode = null;
    },
    destroy: async () => {
      isDestroyed = true;
      clearRecordingLimitTimer();
      if (
        activeMode === "native" ||
        nativePartialResultsListener ||
        nativeSegmentResultsListener ||
        nativeListeningStateListener
      ) {
        await stopNativeRecognition();
      }
      if (mediaRecorder) discardWebRecording();
      else releaseMediaStream();
      mediaRecorder = null;
      mediaChunks = [];
      activeMode = null;
    },
  };
};
