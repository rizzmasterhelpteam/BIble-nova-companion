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
const subscriptionSyncSource = readFileSync(
  new URL("../src/lib/native/subscriptionSync.ts", import.meta.url),
  "utf8",
);
const appStylesSource = readFileSync(
  new URL("../src/index.css", import.meta.url),
  "utf8",
);
const capacitorConfigSource = readFileSync(
  new URL("../capacitor.config.ts", import.meta.url),
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
    expect(voiceModeSource).toContain("const refreshedReady = await onRetryLiveReady();");
    expect(voiceModeSource).toContain("ready = refreshedReady || ready;");
    expect(voiceModeSource).toContain("live.primeAudioForUserGesture();");
    expect(voiceModeSource).toContain("if (ready) await live.start();");
  });

  it("does not block a Voice retry on Android speech diagnostics", () => {
    expect(chatSource).toContain('void refreshSpeechSupport("api-status-retry");');
    expect(chatSource).not.toContain('await refreshSpeechSupport("api-status-retry");');
  });

  it("does not let stale native recovery block Voice eligibility", () => {
    const resumeIndex = liveHookSource.indexOf(
      "const audioResumePromise = audioResumePromiseRef.current || activatedAudioContext.resume();",
    );
    const pendingStorageIndex = liveHookSource.indexOf('"pending-token-read-before-start"');
    const eligibilityIndex = liveHookSource.indexOf('"eligibility-request"');

    expect(resumeIndex).toBeGreaterThan(-1);
    expect(pendingStorageIndex).toBeGreaterThan(resumeIndex);
    expect(eligibilityIndex).toBeGreaterThan(pendingStorageIndex);
    expect(liveHookSource).not.toContain("await retryPendingRelease();");
    expect(liveHookSource).toContain("runNativeVoiceStorageOperation");
  });

  it("requests Android microphone access before WebView capture", () => {
    const eligibilityIndex = liveHookSource.indexOf('"eligibility-request"');
    const nativePermissionIndex = liveHookSource.indexOf("await requestNativeVoiceMicrophonePermission();");
    const captureIndex = liveHookSource.indexOf("stream = await navigator.mediaDevices.getUserMedia");

    expect(liveHookSource).toContain("SpeechRecognition.checkPermissions()");
    expect(liveHookSource).toContain("SpeechRecognition.requestPermissions()");
    expect(nativePermissionIndex).toBeGreaterThan(eligibilityIndex);
    expect(captureIndex).toBeGreaterThan(nativePermissionIndex);
  });

  it("repairs native premium access only after the server rejects eligibility", () => {
    const eligibilityIndex = liveHookSource.indexOf('"eligibility-request"');
    const entitlementRepairIndex = liveHookSource.indexOf("await refreshNativeVoiceEntitlement();");
    const retryIndex = liveHookSource.indexOf('"eligibility-retry-after-entitlement-sync"');

    expect(entitlementRepairIndex).toBeGreaterThan(eligibilityIndex);
    expect(retryIndex).toBeGreaterThan(entitlementRepairIndex);
    expect(subscriptionSyncSource).toContain("selectNewestConfiguredNativePurchase");
    expect(subscriptionSyncSource).toContain("NATIVE_ENTITLEMENT_SYNC_TIMEOUT_MS");
  });

  it("lets a premium retry revalidate before sending someone to plan management", () => {
    expect(voiceModeSource).not.toContain('if (premiumRequired) {\n      navigate("/paywall");');
    expect(voiceModeSource).toContain("Recheck premium access");
    expect(voiceModeSource).toContain("Manage premium plan");
  });

  it("primes Android audio before a readiness retry can yield", () => {
    const primeIndex = voiceModeSource.indexOf("live.primeAudioForUserGesture();");
    const statusRetryIndex = voiceModeSource.indexOf(
      "const refreshedReady = await onRetryLiveReady();",
    );

    expect(primeIndex).toBeGreaterThan(-1);
    expect(statusRetryIndex).toBeGreaterThan(primeIndex);
  });

  it("keeps the retry control tappable while readiness is being refreshed", () => {
    expect(voiceModeSource).toContain('aria-busy={isCheckingLiveReady}');
    expect(voiceModeSource).not.toContain(
      "disabled={isTyping || cooldownActive || isCheckingLiveReady}",
    );
    expect(voiceModeSource).toContain("ready = refreshedReady || ready;");
  });

  it("uses Android-safe microphone capture and falls back when a worklet is silent", () => {
    expect(liveHookSource).toContain("echoCancellation: false");
    expect(liveHookSource).toContain("noiseSuppression: false");
    expect(liveHookSource).toContain("autoGainControl: false");
    expect(liveHookSource).toContain('"switching-to-script-processor"');
    expect(liveHookSource).toContain("audio-input-first-frame");
    expect(liveHookSource).toContain("audio-input-activity-detected");
    expect(liveHookSource).toContain("toPcmByteView(event.data)");
  });

  it("bounds the provider connection and preserves quick Android background transitions", () => {
    expect(liveHookSource).toContain('"gemini-live-connect"');
    expect(liveHookSource).toContain("VOICE_LIVE_CONNECT_TIMEOUT_MS");
    expect(liveHookSource).toContain("VOICE_NATIVE_BACKGROUND_GRACE_MS");
    expect(liveHookSource).toContain("app-state-resumed-within-grace");
    expect(liveHookSource).toContain("if (isNativePlatform()) return;");
    expect(liveHookSource).toContain('void latestStopRef.current?.("ended");');
    expect(liveHookSource).not.toContain('void stop("ended");\n  }, [stop]);');
  });

  it("keeps Voice actions scrollable and outside Android safe-area obstructions", () => {
    expect(appStylesSource).toContain("overflow-y: auto;");
    expect(appStylesSource).toContain("touch-action: pan-y;");
    expect(appStylesSource).toContain("env(safe-area-inset-top");
    expect(voiceModeSource).not.toContain('<div className="min-h-12" aria-hidden="true" />');
    expect(voiceModeSource).toContain('"grid-cols-3" : "grid-cols-2"');
  });

  it("suppresses native bridge payload logging without disabling JS diagnostics", () => {
    expect(capacitorConfigSource).toContain('loggingBehavior: "none"');
    expect(liveHookSource).toContain("[Bible Nova voice diagnostics]");
  });
});
