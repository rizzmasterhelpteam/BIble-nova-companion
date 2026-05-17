import { apiFetch } from "./apiClient";

type TextToSpeechCallbacks = {
  onSpeakingChange: (messageId: string | null) => void;
  onError: (message: string) => void;
};

export type TextToSpeechSession = {
  isSupported: () => boolean;
  speak: (messageId: string, text: string) => Promise<void>;
  stop: () => void;
  destroy: () => void;
};

const normalizeText = (text: string) => text.trim().replace(/\s+/g, " ");

export const createTextToSpeechSession = ({
  onSpeakingChange,
  onError,
}: TextToSpeechCallbacks): TextToSpeechSession => {
  let activeAudio: HTMLAudioElement | null = null;
  let activeMessageId: string | null = null;

  const reset = () => {
    if (activeAudio) {
      activeAudio.pause();
      activeAudio.src = "";
      activeAudio = null;
    }

    activeMessageId = null;
    onSpeakingChange(null);
  };

  return {
    isSupported: () => typeof Audio !== "undefined",
    speak: async (messageId, text) => {
      if (typeof Audio === "undefined") {
        throw new Error("Audio playback is not available on this device.");
      }

      const normalizedText = normalizeText(text);
      if (!normalizedText) return;

      reset();

      const response = await apiFetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: normalizedText }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        audio?: string;
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || `Voice generation failed (${response.status}).`);
      }

      if (!data.audio) {
        throw new Error("Voice generation returned no audio.");
      }

      const audio = new Audio(data.audio);
      activeAudio = audio;
      activeMessageId = messageId;

      audio.onended = () => {
        if (activeMessageId === messageId) {
          reset();
        }
      };

      audio.onerror = () => {
        if (activeMessageId === messageId) {
          reset();
        }
        onError("Voice playback could not start on this device.");
      };

      onSpeakingChange(messageId);

      try {
        await audio.play();
      } catch (error) {
        reset();
        throw error instanceof Error
          ? error
          : new Error("Voice playback could not start on this device.");
      }
    },
    stop: () => {
      reset();
    },
    destroy: () => {
      reset();
    },
  };
};
