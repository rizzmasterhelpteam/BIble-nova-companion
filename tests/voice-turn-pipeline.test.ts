import { describe, expect, it, vi } from "vitest";
import {
  getAdaptiveSilenceMs,
  getVoiceVadThresholds,
  isIntentionalVoiceSpeech,
  NO_SPEECH_TIMEOUT_MS,
  runVoiceTurn,
  VoiceTurnPipelineError,
  type VoiceTurnCheckpoint,
} from "../src/lib/voiceTurnPipeline";

const createCheckpoint = (): VoiceTurnCheckpoint => ({
  blob: new Blob(["audio"], { type: "audio/webm" }),
});

const createDependencies = () => {
  const sequence: string[] = [];
  const dependencies = {
    isCurrent: vi.fn(() => true),
    isMuted: vi.fn(() => false),
    onPhase: vi.fn((phase: string) => sequence.push(`phase:${phase}`)),
    transcribe: vi.fn(async () => {
      sequence.push("transcribe");
      return "I feel worried";
    }),
    commitUser: vi.fn(() => sequence.push("commit-user")),
    respond: vi.fn(async () => {
      sequence.push("respond");
      return "You're not carrying this alone. Take one slow breath with me.";
    }),
    commitAssistant: vi.fn(() => sequence.push("commit-assistant")),
    synthesize: vi.fn(async () => {
      sequence.push("tts");
      return new Uint8Array([1, 2, 3]).buffer;
    }),
    play: vi.fn(async () => {
      sequence.push("play");
    }),
    restartListening: vi.fn(async () => {
      sequence.push("restart");
      return true;
    }),
    setReady: vi.fn(() => sequence.push("ready")),
  };
  return { dependencies, sequence };
};

describe("Voice turn pipeline", () => {
  it("completes two consecutive turns and automatically listens after each", async () => {
    const { dependencies, sequence } = createDependencies();
    const release = vi.fn();

    await runVoiceTurn(createCheckpoint(), dependencies);
    await runVoiceTurn(createCheckpoint(), dependencies);

    expect(dependencies.transcribe).toHaveBeenCalledTimes(2);
    expect(dependencies.respond).toHaveBeenCalledTimes(2);
    expect(dependencies.synthesize).toHaveBeenCalledTimes(2);
    expect(dependencies.play).toHaveBeenCalledTimes(2);
    expect(dependencies.restartListening).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
    expect(sequence.filter((entry) => entry === "restart")).toHaveLength(2);
  });

  it("preserves the assistant response when TTS fails and retries without duplicates", async () => {
    const { dependencies } = createDependencies();
    dependencies.synthesize
      .mockRejectedValueOnce(new Error("TTS unavailable"))
      .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
    const checkpoint = createCheckpoint();

    let retryCheckpoint: VoiceTurnCheckpoint | null = null;
    try {
      await runVoiceTurn(checkpoint, dependencies);
    } catch (error) {
      expect(error).toBeInstanceOf(VoiceTurnPipelineError);
      expect((error as VoiceTurnPipelineError).phase).toBe("tts");
      retryCheckpoint = (error as VoiceTurnPipelineError).checkpoint;
    }

    expect(retryCheckpoint?.assistantText).toContain("not carrying this alone");
    await runVoiceTurn(retryCheckpoint!, dependencies);
    expect(dependencies.transcribe).toHaveBeenCalledOnce();
    expect(dependencies.respond).toHaveBeenCalledOnce();
    expect(dependencies.commitUser).toHaveBeenCalledOnce();
    expect(dependencies.commitAssistant).toHaveBeenCalledOnce();
    expect(dependencies.synthesize).toHaveBeenCalledTimes(2);
    expect(dependencies.play).toHaveBeenCalledOnce();
  });

  it("keeps Voice open when microphone restart fails", async () => {
    const { dependencies } = createDependencies();
    dependencies.restartListening.mockResolvedValueOnce(false);

    await expect(runVoiceTurn(createCheckpoint(), dependencies))
      .rejects.toMatchObject({ phase: "restart" });
    expect(dependencies.play).toHaveBeenCalledOnce();
    expect(dependencies.commitAssistant).toHaveBeenCalledOnce();
  });

  it("retries only microphone restart after completed playback", async () => {
    const { dependencies } = createDependencies();
    dependencies.restartListening
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    let retryCheckpoint: VoiceTurnCheckpoint | null = null;
    try {
      await runVoiceTurn(createCheckpoint(), dependencies);
    } catch (error) {
      retryCheckpoint = (error as VoiceTurnPipelineError).checkpoint;
    }
    await runVoiceTurn(retryCheckpoint!, dependencies);

    expect(dependencies.play).toHaveBeenCalledOnce();
    expect(dependencies.restartListening).toHaveBeenCalledTimes(2);
  });

  it("prevents stale playback after session expiry during processing", async () => {
    const { dependencies } = createDependencies();
    let current = true;
    dependencies.isCurrent.mockImplementation(() => current);
    dependencies.synthesize.mockImplementation(async () => {
      current = false;
      return new Uint8Array([1, 2, 3]).buffer;
    });

    await expect(runVoiceTurn(createCheckpoint(), dependencies)).resolves.toBe("stale");
    expect(dependencies.play).not.toHaveBeenCalled();
    expect(dependencies.restartListening).not.toHaveBeenCalled();
  });

  it("does not commit a stale assistant response over a newer turn", async () => {
    const { dependencies } = createDependencies();
    let current = true;
    dependencies.isCurrent.mockImplementation(() => current);
    dependencies.respond.mockImplementation(async () => {
      current = false;
      return "This response belongs to the old turn.";
    });

    await expect(runVoiceTurn(createCheckpoint(), dependencies)).resolves.toBe("stale");
    expect(dependencies.commitUser).toHaveBeenCalledOnce();
    expect(dependencies.commitAssistant).not.toHaveBeenCalled();
    expect(dependencies.synthesize).not.toHaveBeenCalled();
  });

  it("cannot restart old playback after an interruption starts a newer turn", async () => {
    const { dependencies } = createDependencies();
    let current = true;
    dependencies.isCurrent.mockImplementation(() => current);
    dependencies.play.mockImplementation(async () => {
      current = false;
    });

    await expect(runVoiceTurn(createCheckpoint(), dependencies)).resolves.toBe("stale");
    expect(dependencies.play).toHaveBeenCalledOnce();
    expect(dependencies.restartListening).not.toHaveBeenCalled();
  });

  it("accepts short intentional speech with extra silence while keeping normal turns quick", () => {
    expect(isIntentionalVoiceSpeech(179)).toBe(false);
    expect(isIntentionalVoiceSpeech(180, 0.02, 0.015)).toBe(false);
    expect(isIntentionalVoiceSpeech(180, 0.024, 0.015)).toBe(true);
    expect(isIntentionalVoiceSpeech(320, 0.016, 0.015)).toBe(true);
    expect(getAdaptiveSilenceMs(200)).toBe(1_050);
    expect(getAdaptiveSilenceMs(900)).toBe(900);
    expect(getAdaptiveSilenceMs(3_000)).toBe(750);
    expect(getAdaptiveSilenceMs(7_000)).toBe(650);
    expect(NO_SPEECH_TIMEOUT_MS).toBe(9_000);
  });

  it("uses a bounded adaptive threshold so quiet speech is not rejected by a fixed floor", () => {
    expect(getVoiceVadThresholds(0.004)).toEqual({
      speechStartThreshold: 0.009,
      speechContinueThreshold: 0.007,
    });
    expect(getVoiceVadThresholds(0.01).speechStartThreshold).toBeCloseTo(0.0145);
    expect(getVoiceVadThresholds(0.01).speechContinueThreshold).toBeCloseTo(0.01044);
    expect(getVoiceVadThresholds(0.03).speechStartThreshold).toBeCloseTo(0.0435);
  });
});
