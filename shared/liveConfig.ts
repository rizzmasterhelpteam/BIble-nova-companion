export const GEMINI_LIVE_API_VERSION = "v1beta";
export const GEMINI_LIVE_VOICE = "Gacrux";
// Kept shared so the client connection and server-issued token cannot drift.
// These values keep natural pauses while avoiding delayed Android turn completion.
export const GEMINI_LIVE_VAD = {
  disabled: false,
  prefixPaddingMs: 140,
  silenceDurationMs: 700,
} as const;
