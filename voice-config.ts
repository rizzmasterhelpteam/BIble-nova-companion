export const DEFAULT_VOICE_SESSION_MAX_MINUTES = 10;
export const DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS = 45;

export const getVoiceSessionMaxMinutes = () => {
  const configured = Number(
    process.env.VOICE_SESSION_MAX_MINUTES || DEFAULT_VOICE_SESSION_MAX_MINUTES,
  );
  return Number.isFinite(configured) && configured >= 1 && configured <= 15
    ? Math.floor(configured)
    : DEFAULT_VOICE_SESSION_MAX_MINUTES;
};

export const getVoiceIdleTimeoutSeconds = () => {
  const configured = Number(
    process.env.VOICE_IDLE_TIMEOUT_SECONDS || DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS,
  );
  return Number.isFinite(configured) && configured >= 15 && configured <= 300
    ? Math.floor(configured)
    : DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS;
};

export const getVoiceSessionConfig = () => ({
  maxMinutes: getVoiceSessionMaxMinutes(),
  idleTimeoutSeconds: getVoiceIdleTimeoutSeconds(),
});
