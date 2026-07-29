export const VOICE_LANGUAGE_OPTIONS = [
  "auto",
  "english",
  "hindi",
  "hinglish",
] as const;

export type VoiceLanguage = (typeof VOICE_LANGUAGE_OPTIONS)[number];

export const normalizeVoiceLanguage = (value: unknown): VoiceLanguage =>
  typeof value === "string" &&
  (VOICE_LANGUAGE_OPTIONS as readonly string[]).includes(value)
    ? value as VoiceLanguage
    : "auto";

export const getWhisperLanguage = (voiceLanguage: VoiceLanguage) => {
  if (voiceLanguage === "english") return "en";
  if (voiceLanguage === "hindi") return "hi";
  return undefined;
};

export const getVoiceLanguageInstruction = (voiceLanguage: VoiceLanguage) => {
  switch (voiceLanguage) {
    case "english":
      return "Reply in natural spoken English.";
    case "hindi":
      return "Reply in natural, spoken Hindi using Devanagari when appropriate.";
    case "hinglish":
      return "Reply in natural Indian Hinglish, not a literal translation.";
    default:
      return "Reply naturally in the language and style used by the user. Keep language consistent within this turn.";
  }
};

export const getWhisperVocabularyPrompt = (voiceLanguage: VoiceLanguage) =>
  voiceLanguage === "hindi" || voiceLanguage === "hinglish"
    ? "Bible Nova, Jesus, Yesu, Bible, Genesis, Psalms, Proverbs, Matthew, Romans, prayer, dua"
    : "Bible Nova, Jesus, Bible, Genesis, Psalms, Proverbs, Matthew, Romans, prayer";
