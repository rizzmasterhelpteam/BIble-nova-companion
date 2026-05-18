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

const hasSpeechSynthesisSupport = () =>
  typeof window !== "undefined" &&
  "speechSynthesis" in window &&
  "SpeechSynthesisUtterance" in window;

const normalizeText = (text: string) => text.trim().replace(/\s+/g, " ");

const scoreVoice = (voice: SpeechSynthesisVoice) => {
  const name = voice.name.toLowerCase();
  const lang = voice.lang.toLowerCase();
  let score = 0;

  if (lang.startsWith("en")) score += 40;
  if (voice.localService) score += 20;
  if (voice.default) score += 10;

  if (/google uk english male/.test(name)) score += 220;
  if (/male|man/.test(name)) score += 100;
  if (/deep|baritone|bass|narrator|news|mature|smooth|velvet|rich/.test(name)) score += 95;
  if (/british male|english male|male english/.test(name)) score += 70;
  if (/daniel|fred|aaron|arthur|david|nathan|oliver|thomas|alex|jorge|diego/i.test(voice.name)) {
    score += 80;
  }
  if (/english|british|australian|irish/.test(name)) score += 20;
  if (/female|woman|girl|child|junior|zira|samantha|victoria|karen|moira|ava|allison/i.test(voice.name)) {
    score -= 120;
  }
  if (/whisper|soft|cute|light|high/.test(name)) score -= 50;

  return score;
};

const waitForVoices = () =>
  new Promise<SpeechSynthesisVoice[]>((resolve) => {
    if (!hasSpeechSynthesisSupport()) {
      resolve([]);
      return;
    }

    const existing = window.speechSynthesis.getVoices();
    if (existing.length) {
      resolve(existing);
      return;
    }

    let resolved = false;
    let timeoutId = 0;

    const resolveOnce = (voices: SpeechSynthesisVoice[]) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(voices);
    };

    const handleVoicesChanged = () => {
      const nextVoices = window.speechSynthesis.getVoices();
      if (!nextVoices.length) return;
      resolveOnce(nextVoices);
    };

    window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);

    timeoutId = window.setTimeout(() => {
      resolveOnce(window.speechSynthesis.getVoices());
    }, 1200);
  });

const pickPreferredVoice = async () => {
  const voices = await waitForVoices();
  if (!voices.length) return null;
  return [...voices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
};

export const createTextToSpeechSession = ({
  onSpeakingChange,
  onError,
}: TextToSpeechCallbacks): TextToSpeechSession => {
  let activeMessageId: string | null = null;
  let playbackRequestId = 0;

  const reset = () => {
    activeMessageId = null;
    onSpeakingChange(null);
  };

  return {
    isSupported: () => hasSpeechSynthesisSupport(),
    speak: async (messageId, text) => {
      if (!hasSpeechSynthesisSupport()) {
        throw new Error("Text-to-speech is not available on this device.");
      }

      const normalizedText = normalizeText(text);
      if (!normalizedText) return;

      playbackRequestId += 1;
      const requestId = playbackRequestId;
      window.speechSynthesis.cancel();
      reset();

      const utterance = new SpeechSynthesisUtterance(normalizedText);
      const preferredVoice = await pickPreferredVoice();

      if (requestId !== playbackRequestId) {
        return;
      }

      if (preferredVoice) {
        utterance.voice = preferredVoice;
        utterance.lang = preferredVoice.lang;
      } else {
        utterance.lang = navigator.language || "en-US";
      }

      utterance.rate = 0.86;
      utterance.pitch = 0.68;
      utterance.volume = 1;

      utterance.onstart = () => {
        if (requestId !== playbackRequestId) {
          return;
        }
        activeMessageId = messageId;
        onSpeakingChange(messageId);
      };

      utterance.onend = () => {
        if (requestId !== playbackRequestId) {
          return;
        }
        if (activeMessageId === messageId) {
          reset();
        }
      };

      utterance.onerror = (event) => {
        if (requestId !== playbackRequestId) {
          return;
        }

        if (event.error === "interrupted" || event.error === "canceled") {
          if (activeMessageId === messageId) {
            reset();
          }
          return;
        }

        if (activeMessageId === messageId) {
          reset();
        }
        onError("Voice playback could not start on this device.");
      };

      window.speechSynthesis.speak(utterance);
    },
    stop: () => {
      if (!hasSpeechSynthesisSupport()) return;
      playbackRequestId += 1;
      window.speechSynthesis.cancel();
      reset();
    },
    destroy: () => {
      if (!hasSpeechSynthesisSupport()) return;
      playbackRequestId += 1;
      window.speechSynthesis.cancel();
      reset();
    },
  };
};
