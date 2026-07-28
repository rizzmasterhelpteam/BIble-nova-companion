export const GEMINI_LIVE_API_VERSION = "v1beta";
export const GEMINI_LIVE_VOICE = "Gacrux";
// Kept shared so the client connection and server-issued token cannot drift.
// These values keep natural pauses while avoiding the previous 1.3 s response delay.
export const GEMINI_LIVE_VAD = {
  prefixPaddingMs: 140,
  silenceDurationMs: 850,
} as const;
