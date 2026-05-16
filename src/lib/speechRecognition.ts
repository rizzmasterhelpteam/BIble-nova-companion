import { SpeechRecognition as NativeSpeechRecognition } from "@capacitor-community/speech-recognition";
import type { PluginListenerHandle } from "@capacitor/core";
import { apiFetch } from "./apiClient";
import { getNativePlatform, isNativePlatform } from "./native/platform";

type SpeechRecognitionCallbacks = {
  onTranscript: (text: string) => void;
  onListeningChange: (isListening: boolean) => void;
  onProcessingChange: (isProcessing: boolean) => void;
  onError: (message: string) => void;
};

export type SpeechRecognitionSession = {
  start: (initialText?: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  isSupported: () => Promise<boolean>;
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

const shouldUseNativeSpeechRecognition = () =>
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
  onError,
}: SpeechRecognitionCallbacks): SpeechRecognitionSession => {
  let baseText = "";
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let mediaChunks: Blob[] = [];
  let nativePartialResultsListener: PluginListenerHandle | null = null;
  let nativeListeningStateListener: PluginListenerHandle | null = null;

  const stopNativeRecognition = async () => {
    await NativeSpeechRecognition.stop().catch(() => undefined);
    await removeNativeListener(nativePartialResultsListener);
    await removeNativeListener(nativeListeningStateListener);
    nativePartialResultsListener = null;
    nativeListeningStateListener = null;
  };

  const releaseMediaStream = () => {
    mediaStream?.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  };

  const stopWebRecording = async () => {
    if (!mediaRecorder) return;

    const currentRecorder = mediaRecorder;
    mediaRecorder = null;

    await new Promise<void>((resolve) => {
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
          onListeningChange(false);
          onError("No speech was captured.");
          resolve();
          return;
        }

        onListeningChange(false);
        onProcessingChange(true);

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

          onTranscript(mergeTranscript(baseText, data.text || ""));
        } catch (error) {
          onError(error instanceof Error ? error.message : "Speech transcription failed.");
        } finally {
          onProcessingChange(false);
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
    });
  };

  return {
    isSupported: async () => {
      if (shouldUseNativeSpeechRecognition()) {
        try {
          const { available } = await NativeSpeechRecognition.available();
          return available;
        } catch {
          return false;
        }
      }

      return isWebRecordingSupported();
    },
    start: async (initialText = "") => {
      baseText = initialText;

      if (shouldUseNativeSpeechRecognition()) {
        const { available } = await NativeSpeechRecognition.available();
        if (!available) {
          throw new Error("Speech recognition is not available on this device.");
        }

        const { speechRecognition } = await NativeSpeechRecognition.requestPermissions();
        if (speechRecognition !== "granted") {
          throw new Error("Microphone access was denied. Allow it in system settings.");
        }

        await stopNativeRecognition();

        nativePartialResultsListener = await NativeSpeechRecognition.addListener(
          "partialResults",
          ({ matches }) => {
            onTranscript(mergeTranscript(baseText, matches?.[0] || ""));
          },
        );

        nativeListeningStateListener = await NativeSpeechRecognition.addListener(
          "listeningState",
          ({ status }) => {
            const listening = status === "started";
            onListeningChange(listening);
          },
        );

        await NativeSpeechRecognition.start({
          language: navigator.language || "en-US",
          maxResults: 1,
          partialResults: true,
          popup: false,
        });

        onListeningChange(true);
        return;
      }

      if (!isWebRecordingSupported()) {
        throw new Error("Speech recognition is not available in this browser.");
      }

      await stopWebRecording();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        releaseMediaStream();
        mediaRecorder = null;
        mediaChunks = [];
        onListeningChange(false);
        onError("Microphone recording failed.");
      };

      recorder.onstart = () => {
        onListeningChange(true);
      };

      recorder.start();
    },
    stop: async () => {
      if (shouldUseNativeSpeechRecognition()) {
        await stopNativeRecognition();
        onListeningChange(false);
        return;
      }

      await stopWebRecording();
      onListeningChange(false);
    },
    destroy: async () => {
      if (shouldUseNativeSpeechRecognition()) {
        await stopNativeRecognition();
        return;
      }

      releaseMediaStream();
      mediaRecorder = null;
      mediaChunks = [];
    },
  };
};
