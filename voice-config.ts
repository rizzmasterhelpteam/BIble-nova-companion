export const DEFAULT_VOICE_SESSION_MAX_MINUTES = 10;

export const getVoiceSessionMaxMinutes = () => {
  const configured = Number(
    process.env.VOICE_SESSION_MAX_MINUTES || DEFAULT_VOICE_SESSION_MAX_MINUTES,
  );
  return Number.isFinite(configured) && configured >= 1 && configured <= 15
    ? Math.floor(configured)
    : DEFAULT_VOICE_SESSION_MAX_MINUTES;
};

export const getVoiceSessionConfig = () => ({
  maxMinutes: getVoiceSessionMaxMinutes(),
});
