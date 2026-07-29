export const VOICE_PLAYBACK_FADE_IN_MS = 15;
export const VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS = 60;

type PlaybackEnvelopeContext = {
  currentTime: number;
};

type PlaybackEnvelopeGain = {
  gain: {
    value: number;
    cancelScheduledValues: (startTime: number) => void;
    setValueAtTime: (value: number, startTime: number) => unknown;
    linearRampToValueAtTime: (value: number, endTime: number) => unknown;
  };
  disconnect: () => void;
};

type PlaybackEnvelopeSource = {
  stop: (when?: number) => void;
  disconnect: () => void;
};

const disconnectPlaybackNodes = (
  source: PlaybackEnvelopeSource,
  gain: PlaybackEnvelopeGain,
) => {
  try {
    source.disconnect();
  } catch {
    // The source may already be disconnected by its completion callback.
  }
  try {
    gain.disconnect();
  } catch {
    // The gain may already be disconnected by its completion callback.
  }
};

export const applyVoicePlaybackFadeIn = (
  context: PlaybackEnvelopeContext,
  gain: PlaybackEnvelopeGain,
) => {
  const now = context.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(
    1,
    now + VOICE_PLAYBACK_FADE_IN_MS / 1_000,
  );
};

export const stopVoicePlaybackSource = ({
  context,
  source,
  gain,
  fadeOut,
  scheduleCleanup = (cleanup, delayMs) => globalThis.setTimeout(cleanup, delayMs),
}: {
  context: PlaybackEnvelopeContext;
  source: PlaybackEnvelopeSource;
  gain: PlaybackEnvelopeGain;
  fadeOut: boolean;
  scheduleCleanup?: (cleanup: () => void, delayMs: number) => unknown;
}) => {
  if (!fadeOut) {
    try {
      source.stop();
    } finally {
      disconnectPlaybackNodes(source, gain);
    }
    return;
  }

  const now = context.currentTime;
  const stopAt = now + VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS / 1_000;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
  gain.gain.linearRampToValueAtTime(0.0001, stopAt);
  try {
    source.stop(stopAt);
  } catch {
    disconnectPlaybackNodes(source, gain);
    return;
  }
  scheduleCleanup(
    () => disconnectPlaybackNodes(source, gain),
    VOICE_PLAYBACK_INTERRUPT_FADE_OUT_MS + 20,
  );
};
