import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const voiceModeSource = readFileSync(
  new URL("../src/components/voice/VoiceMode.tsx", import.meta.url),
  "utf8",
);
const chatSource = readFileSync(
  new URL("../src/pages/Chat.tsx", import.meta.url),
  "utf8",
);
const liveHookSource = readFileSync(
  new URL("../src/hooks/useGeminiLive.ts", import.meta.url),
  "utf8",
);

describe("Voice mode interface", () => {
  it("does not render caption controls or transcript cards", () => {
    expect(voiceModeSource).not.toContain("Captions");
    expect(voiceModeSource).not.toContain("showCaptions");
    expect(voiceModeSource).not.toContain("voice-transcript");
    expect(voiceModeSource).not.toContain("latestTranscript");
  });

  it("rechecks readiness and starts Live when readiness is recovered", () => {
    expect(voiceModeSource).toContain("ready = await onRetryLiveReady();");
    expect(voiceModeSource).toContain("void onRetryLiveReady();");
    expect(voiceModeSource).toContain("if (ready) await live.start();");
  });

  it("does not block a Voice retry on Android speech diagnostics", () => {
    expect(chatSource).toContain('void refreshSpeechSupport("api-status-retry");');
    expect(chatSource).not.toContain('await refreshSpeechSupport("api-status-retry");');
  });

  it("activates Android audio before native storage or network awaits", () => {
    const resumeIndex = liveHookSource.indexOf("const audioResumePromise = activatedAudioContext.resume();");
    const pendingReleaseIndex = liveHookSource.indexOf("if (!isReconnect) await retryPendingRelease();");

    expect(resumeIndex).toBeGreaterThan(-1);
    expect(pendingReleaseIndex).toBeGreaterThan(resumeIndex);
  });
});
