import { SpeechRecognition as NativeSpeechRecognition } from "@capacitor-community/speech-recognition";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform } from "./native/platform";

type SpeechRecognitionCallbacks = {
  onTranscript: (text: string) => void;
  onListeningChange: (isListening: boolean) => void;
  onError: (message: string) => void;
};

export type SpeechRecognitionSession = {
  start: (initialText?: string) => Promise<void>;
  stop: () => Promise<void>;
  destroy: () => Promise<void>;
  isSupported: () => Promise<boolean>;
};

interface BrowserRecognitionAlternative {
  transcript: string;
}

interface BrowserRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserRecognitionAlternative;
}

interface BrowserRecognitionResultList {
  readonly length: number;
  [index: number]: BrowserRecognitionResult;
}

interface BrowserRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrowserRecognitionResultList;
}

interface BrowserRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: ((event: Event) => void) | null;
  onerror: ((event: BrowserRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserRecognitionEvent) => void) | null;
  onstart: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

const getBrowserSpeechRecognition = () =>
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const normalizeTranscript = (text: string) => text.trim().replace(/\s+/g, " ");

const mergeTranscript = (prefix: string, transcript: string) => {
  const normalizedTranscript = normalizeTranscript(transcript);
  const normalizedPrefix = normalizeTranscript(prefix);

  if (!normalizedPrefix) return normalizedTranscript;
  if (!normalizedTranscript) return normalizedPrefix;

  return `${normalizedPrefix} ${normalizedTranscript}`;
};

const getWebSpeechErrorMessage = (error: string) => {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow it in your browser settings.";
    case "audio-capture":
      return "No microphone was found for speech recognition.";
    case "network":
      return "Speech recognition hit a network error.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return "Speech recognition could not start.";
  }
};

const removeNativeListener = async (listener: PluginListenerHandle | null) => {
  if (!listener) return;
  await listener.remove().catch(() => undefined);
};

export const createSpeechRecognitionSession = ({
  onTranscript,
  onListeningChange,
  onError,
}: SpeechRecognitionCallbacks): SpeechRecognitionSession => {
  let baseText = "";
  let browserRecognition: BrowserSpeechRecognition | null = null;
  let nativePartialResultsListener: PluginListenerHandle | null = null;
  let nativeListeningStateListener: PluginListenerHandle | null = null;
  let manuallyStopped = false;

  const stopNativeRecognition = async () => {
    await NativeSpeechRecognition.stop().catch(() => undefined);
    await removeNativeListener(nativePartialResultsListener);
    await removeNativeListener(nativeListeningStateListener);
    nativePartialResultsListener = null;
    nativeListeningStateListener = null;
  };

  const stopBrowserRecognition = async (abort = false) => {
    if (!browserRecognition) return;

    const currentRecognition = browserRecognition;
    browserRecognition = null;
    currentRecognition.onstart = null;
    currentRecognition.onresult = null;
    currentRecognition.onerror = null;
    currentRecognition.onend = null;

    if (abort) {
      currentRecognition.abort();
      return;
    }

    currentRecognition.stop();
  };

  return {
    isSupported: async () => {
      if (isNativePlatform()) {
        const { available } = await NativeSpeechRecognition.available();
        return available;
      }

      return Boolean(getBrowserSpeechRecognition());
    },
    start: async (initialText = "") => {
      baseText = initialText;
      manuallyStopped = false;

      if (isNativePlatform()) {
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

      const BrowserRecognition = getBrowserSpeechRecognition();
      if (!BrowserRecognition) {
        throw new Error("Speech recognition is not available in this browser.");
      }

      await stopBrowserRecognition(true);

      const recognition = new BrowserRecognition();
      browserRecognition = recognition;
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        onListeningChange(true);
      };

      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0]?.transcript || "";
        }

        onTranscript(mergeTranscript(baseText, transcript));
      };

      recognition.onerror = (event) => {
        if (event.error === "aborted" && manuallyStopped) return;
        onListeningChange(false);
        onError(getWebSpeechErrorMessage(event.error));
      };

      recognition.onend = () => {
        onListeningChange(false);
      };

      recognition.start();
    },
    stop: async () => {
      manuallyStopped = true;

      if (isNativePlatform()) {
        await stopNativeRecognition();
        onListeningChange(false);
        return;
      }

      await stopBrowserRecognition();
      onListeningChange(false);
    },
    destroy: async () => {
      manuallyStopped = true;

      if (isNativePlatform()) {
        await stopNativeRecognition();
        return;
      }

      await stopBrowserRecognition(true);
    },
  };
};
