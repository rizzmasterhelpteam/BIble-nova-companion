import { SpeechRecognition as NativeSpeechRecognition } from "@capacitor-community/speech-recognition";
import type { PluginListenerHandle } from "@capacitor/core";
import { apiFetch } from "./apiClient";
import { getNativePlatform, isNativePlatform } from "./native/platform";

type SpeechRecognitionCallbacks = {
  onTranscript: (text: string) => void;
  onListeningChange: (isListening: boolean) => void;
  onProcessingChange: (isProcessing: boolean) => void;
  onNotice?: (message: string) => void;
  onError: (message: string) => void;
};

export type RecognitionMode = "web" | "native" | "unsupported";

export type SpeechRecognitionSession = {
  start: (initialText?: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  isSupported: () => Promise<boolean>;
  getMode: () => Promise<RecognitionMode>;
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
}: SpeechRecognitionCallbacks): SpeechRecognitionSession => {
  let baseText = "";
  let isDestroyed = false;
  let activeMode: RecognitionMode | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaChunks: Blob[] = [];
  let stopWebRecordingPromise: Promise<void> | null = null;
  let nativePartialResultsListener: PluginListenerHandle | null = null;
  let nativeListeningStateListener: PluginListenerHandle | null = null;
  let latestNativeTranscript = "";
  let recordingLimitTimer: number | null = null;

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

  const stopNativeRecognition = async (commitTranscript = false) => {
    await NativeSpeechRecognition.stop().catch(() => undefined);
    if (commitTranscript) {
      if (latestNativeTranscript) {
        emitTranscript(mergeTranscript(baseText, latestNativeTranscript));
      } else {
        emitError("No speech was captured. Please try again.");
      }
    }
    await removeNativeListener(nativePartialResultsListener);
    await removeNativeListener(nativeListeningStateListener);
    nativePartialResultsListener = null;
    nativeListeningStateListener = null;
  };

  const resolveRecognitionMode = async (): Promise<RecognitionMode> => {
    if (!isAndroidNativeSpeech()) {
      return isWebRecordingSupported() ? "web" : "unsupported";
    }

    try {
      const { available } = await NativeSpeechRecognition.available();
      return available ? "native" : isWebRecordingSupported() ? "web" : "unsupported";
    } catch {
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

  return {
    getMode: resolveRecognitionMode,
    isSupported: async () => (await resolveRecognitionMode()) !== "unsupported",
    start: async (initialText = "") => {
      baseText = initialText;
      activeMode = await resolveRecognitionMode();

      if (activeMode === "unsupported") {
        throw new Error("Microphone input is not available on this device. You can still type.");
      }

      if (activeMode === "native") {
        const { available } = await NativeSpeechRecognition.available();
        if (!available) {
          throw new Error("Speech recognition is not available on this device.");
        }

        const { speechRecognition } = await NativeSpeechRecognition.requestPermissions();
        if (speechRecognition !== "granted") {
          throw new Error("Microphone access was denied. Enable it in Android settings or type your message.");
        }

        await stopNativeRecognition();
        latestNativeTranscript = "";

        nativePartialResultsListener = await NativeSpeechRecognition.addListener(
          "partialResults",
          ({ matches }) => {
            latestNativeTranscript = normalizeTranscript(matches?.[0] || "");
            emitTranscript(mergeTranscript(baseText, latestNativeTranscript));
          },
        );

        nativeListeningStateListener = await NativeSpeechRecognition.addListener(
          "listeningState",
          ({ status }) => {
            const listening = status === "started";
            emitListeningChange(listening);
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
          emitListeningChange(false);
          throw error;
        }

        emitListeningChange(true);
        return;
      }

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
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaRecorder = recorder;
      mediaChunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunks.push(event.data);
        }
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

      recorder.start();
      activeMode = "web";
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

      if (activeMode === "native" || isAndroidNativeSpeech()) {
        await stopNativeRecognition();
        if (activeMode === "native") {
          activeMode = null;
          return;
        }
      }

      if (mediaRecorder) {
        discardWebRecording();
        activeMode = null;
        return;
      }

      releaseMediaStream();
      mediaRecorder = null;
      mediaChunks = [];
      activeMode = null;
    },
  };
};
