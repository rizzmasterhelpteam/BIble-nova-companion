export type VoiceTurnPhase =
  | "transcription"
  | "response"
  | "tts"
  | "playback"
  | "restart";

export type VoiceTurnCheckpoint = {
  blob: Blob;
  transcript?: string;
  assistantText?: string;
  assistantMessageId?: string;
  audio?: ArrayBuffer;
  userCommitted?: boolean;
  assistantCommitted?: boolean;
  playbackCompleted?: boolean;
};

export type VoiceTurnResult = "completed" | "muted" | "stale";

export const TINY_UTTERANCE_SILENCE_MS = 1_050;
export const SHORT_UTTERANCE_SILENCE_MS = 900;
export const NORMAL_SILENCE_MS = 750;
export const LONG_UTTERANCE_SILENCE_MS = 650;
export const MIN_INTENTIONAL_SPEECH_MS = 180;
export const SHORT_INTENTIONAL_SPEECH_MS = 300;
export const SHORT_SPEECH_PEAK_MULTIPLIER = 1.5;
export const NO_SPEECH_TIMEOUT_MS = 9_000;

const VAD_START_FLOOR = 0.009;
const VAD_CONTINUE_FLOOR = 0.007;
const VAD_NOISE_MULTIPLIER = 1.45;
const VAD_CONTINUE_MULTIPLIER = 0.72;

export const getVoiceVadThresholds = (ambientRms: number) => {
  const safeAmbientRms = Number.isFinite(ambientRms) && ambientRms > 0
    ? ambientRms
    : 0;
  const speechStartThreshold = Math.max(
    VAD_START_FLOOR,
    safeAmbientRms * VAD_NOISE_MULTIPLIER,
  );
  return {
    speechStartThreshold,
    speechContinueThreshold: Math.max(
      VAD_CONTINUE_FLOOR,
      speechStartThreshold * VAD_CONTINUE_MULTIPLIER,
    ),
  };
};

export const getAdaptiveSilenceMs = (speechDurationMs: number) => {
  if (speechDurationMs < 300) return TINY_UTTERANCE_SILENCE_MS;
  if (speechDurationMs < 1_500) return SHORT_UTTERANCE_SILENCE_MS;
  if (speechDurationMs >= 6_000) return LONG_UTTERANCE_SILENCE_MS;
  return NORMAL_SILENCE_MS;
};

export const isIntentionalVoiceSpeech = (
  speechDurationMs: number,
  speechPeakRms = Number.POSITIVE_INFINITY,
  speechStartThreshold = 0,
) => {
  if (speechDurationMs < MIN_INTENTIONAL_SPEECH_MS) return false;
  // Very short replies need a clearer signal so handling noise does not
  // become a Whisper request, while quiet normal speech still gets through.
  if (speechDurationMs < SHORT_INTENTIONAL_SPEECH_MS) {
    return speechPeakRms >= speechStartThreshold * SHORT_SPEECH_PEAK_MULTIPLIER;
  }
  return true;
};

export class VoiceTurnPipelineError extends Error {
  readonly phase: VoiceTurnPhase;
  readonly checkpoint: VoiceTurnCheckpoint;

  constructor(
    phase: VoiceTurnPhase,
    checkpoint: VoiceTurnCheckpoint,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "VoiceTurnPipelineError";
    this.phase = phase;
    this.checkpoint = checkpoint;
    if (cause instanceof Error && cause.stack) this.stack = cause.stack;
  }
}

type VoiceTurnDependencies = {
  isCurrent: () => boolean;
  isMuted: () => boolean;
  onPhase: (phase: VoiceTurnPhase) => void;
  transcribe: (blob: Blob) => Promise<string>;
  commitUser: (text: string) => void;
  respond: () => Promise<string>;
  commitAssistant: (text: string) => void;
  synthesize: (text: string) => Promise<ArrayBuffer>;
  play: (audio: ArrayBuffer) => Promise<void>;
  restartListening: () => Promise<boolean>;
  setReady: () => void;
};

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === "AbortError";

export async function runVoiceTurn(
  checkpoint: VoiceTurnCheckpoint,
  dependencies: VoiceTurnDependencies,
): Promise<VoiceTurnResult> {
  let phase: VoiceTurnPhase = "transcription";

  try {
    if (!checkpoint.transcript) {
      dependencies.onPhase(phase);
      checkpoint.transcript = (await dependencies.transcribe(checkpoint.blob)).trim();
      if (!checkpoint.transcript) throw new Error("No speech was captured. Please try again.");
    }
    if (!dependencies.isCurrent()) return "stale";

    if (!checkpoint.userCommitted) {
      dependencies.commitUser(checkpoint.transcript);
      checkpoint.userCommitted = true;
    }

    if (!checkpoint.assistantText) {
      phase = "response";
      dependencies.onPhase(phase);
      checkpoint.assistantText = (await dependencies.respond()).trim();
      if (!checkpoint.assistantText) throw new Error("The reflection response was empty.");
    }
    if (!dependencies.isCurrent()) return "stale";

    if (!checkpoint.assistantCommitted) {
      dependencies.commitAssistant(checkpoint.assistantText);
      checkpoint.assistantCommitted = true;
    }

    if (!checkpoint.audio) {
      phase = "tts";
      dependencies.onPhase(phase);
      checkpoint.audio = await dependencies.synthesize(checkpoint.assistantText);
    }
    if (!dependencies.isCurrent()) return "stale";

    if (!checkpoint.playbackCompleted) {
      phase = "playback";
      dependencies.onPhase(phase);
      await dependencies.play(checkpoint.audio);
      checkpoint.playbackCompleted = true;
    }
    if (!dependencies.isCurrent()) return "stale";

    if (dependencies.isMuted()) {
      dependencies.setReady();
      return "muted";
    }

    phase = "restart";
    dependencies.onPhase(phase);
    if (!(await dependencies.restartListening())) {
      throw new Error("The microphone could not restart. Please try listening again.");
    }
    return "completed";
  } catch (error) {
    if (isAbortError(error) || error instanceof VoiceTurnPipelineError) throw error;
    throw new VoiceTurnPipelineError(phase, checkpoint, error);
  }
}
