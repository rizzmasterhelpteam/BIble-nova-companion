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
const voiceHookSource = readFileSync(
  new URL("../src/hooks/useTurnBasedVoice.ts", import.meta.url),
  "utf8",
);
const voiceSessionSource = readFileSync(
  new URL("../api/voice/session.ts", import.meta.url),
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

  it("rechecks readiness and starts turn-based Voice when readiness is recovered", () => {
    expect(voiceModeSource).toContain("const refreshedReady = await onRetryVoiceReady();");
    expect(voiceModeSource).toContain("ready = refreshedReady || ready;");
    expect(voiceModeSource).toContain("live.primeAudioForUserGesture();");
    expect(voiceModeSource).toContain("if (ready) {");
    expect(voiceModeSource).toContain("await live.start(");
    expect(voiceModeSource).toContain("useTurnBasedVoice");
  });

  it("does not block a Voice retry on Android speech diagnostics", () => {
    expect(chatSource).toContain('void refreshSpeechSupport("api-status-retry");');
    expect(chatSource).not.toContain('await refreshSpeechSupport("api-status-retry");');
  });

  it("distinguishes fresh starts from safe interrupted-session recovery", () => {
    expect(voiceHookSource).toContain("createClientReservationHandle");
    expect(voiceHookSource).toContain("reservationHandle: requestedHandle");
    expect(voiceHookSource).toContain("previousReservationHandle");
    expect(voiceHookSource).toContain('"fresh_start"');
    expect(voiceHookSource).toContain('"recovery_resume"');
    expect(voiceSessionSource).toContain('availability.reason === "reservation_resume"');
    expect(voiceSessionSource).toContain("MIN_RECOVERY_REMAINING_SECONDS");
    expect(voiceSessionSource).toContain("resumed: true");
  });

  it("requests Android microphone access before WebView capture", () => {
    const nativePermissionIndex = voiceHookSource.indexOf("SpeechRecognition.checkPermissions()");
    const requestPermissionIndex = voiceHookSource.indexOf("SpeechRecognition.requestPermissions()");
    const captureIndex = voiceHookSource.indexOf("navigator.mediaDevices.getUserMedia({");

    expect(nativePermissionIndex).toBeGreaterThan(-1);
    expect(requestPermissionIndex).toBeGreaterThan(nativePermissionIndex);
    expect(captureIndex).toBeGreaterThan(requestPermissionIndex);
  });

  it("repairs native premium access only after the server rejects eligibility", () => {
    const eligibilityIndex = voiceHookSource.indexOf("let response = await requestSession();");
    const entitlementRepairIndex = voiceHookSource.indexOf("refreshNativeSubscriptionEntitlement");
    const retryIndex = voiceHookSource.lastIndexOf("response = await requestSession();");

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
      "const refreshedReady = await onRetryVoiceReady();",
    );

    expect(primeIndex).toBeGreaterThan(-1);
    expect(statusRetryIndex).toBeGreaterThan(primeIndex);
  });

  it("keeps the retry control tappable while readiness is being refreshed", () => {
    expect(voiceModeSource).toContain('aria-busy={isCheckingVoiceReady}');
    expect(voiceModeSource).not.toContain(
      "disabled={isTyping || cooldownActive || isCheckingVoiceReady}",
    );
    expect(voiceModeSource).toContain("ready = refreshedReady || ready;");
  });

  it("uses processed Android recording, Groq transcription, and explicit turn completion", () => {
    expect(voiceHookSource).toContain("echoCancellation: true");
    expect(voiceHookSource).toContain("noiseSuppression: true");
    expect(voiceHookSource).toContain("autoGainControl: true");
    expect(voiceHookSource).toContain('apiFetch("/api/transcribe"');
    expect(voiceHookSource).toContain("createVoiceTranscriptionFormData");
    expect(voiceHookSource).toContain('apiFetch("/api/voice/respond"');
    expect(voiceHookSource).toContain('mode: "voice"');
    expect(voiceHookSource).toContain('apiFetch("/api/tts"');
    expect(voiceHookSource).toContain("decodeAudioData");
    expect(voiceHookSource).toContain("source.start()");
    expect(voiceHookSource).toContain("getAdaptiveSilenceMs");
    expect(voiceModeSource).toContain("Done speaking");
  });

  it("releases recording, playback, requests, and the premium lease on stop", () => {
    expect(voiceHookSource).toContain("requestControllerRef.current?.abort()");
    expect(voiceHookSource).toContain("releaseStream()");
    expect(voiceHookSource).toContain('stopPlayback("cleanup")');
    expect(voiceHookSource).toContain("await releaseReservation(");
    expect(voiceHookSource).toContain("releaseReason");
    expect(voiceHookSource).toContain("await targetContext.close()");
  });

  it("keeps recoverable provider and microphone failures inside Voice Mode", () => {
    expect(voiceModeSource).toContain("showRetryableSessionError");
    expect(voiceModeSource).toContain("Continue in Chat");
    expect(voiceModeSource).toContain("live.retryLabel");
    expect(voiceModeSource).toContain("live.isSessionActive");
  });

  it("keeps one microphone stream warm and supports spoken barge-in", () => {
    expect(voiceHookSource).toContain("VoiceMicrophoneSession");
    expect(voiceHookSource).toContain('"mic_stream_reused"');
    expect(voiceHookSource).toContain("AdaptiveBargeInDetector");
    expect(voiceHookSource).toContain("interruptFromUserSpeech");
    expect(voiceHookSource).toContain('stopPlayback("barge_in_interrupt")');
    expect(voiceHookSource).not.toContain("blobToDataUrl");
    const normalStopStart = voiceHookSource.indexOf("recorder.onstop = () =>");
    const normalStopBlock = voiceHookSource.slice(
      normalStopStart,
      voiceHookSource.indexOf("const analyser = analyserRef.current", normalStopStart),
    );
    const bargeInBlock = voiceHookSource.slice(
      voiceHookSource.indexOf("const interruptFromUserSpeech ="),
      voiceHookSource.indexOf("const start = useCallback"),
    );
    expect(normalStopBlock).not.toContain("releaseStream(");
    expect(normalStopBlock).toContain(
      "recordingOperation !== recordingOperationRef.current",
    );
    expect(normalStopBlock.indexOf("if (!discard)")).toBeLessThan(
      normalStopBlock.indexOf("stopVad();"),
    );
    expect(bargeInBlock).not.toContain("releaseReservation(");
  });

  it("keeps Voice actions scrollable and outside Android safe-area obstructions", () => {
    expect(appStylesSource).toContain("overflow-y: auto;");
    expect(appStylesSource).toContain("touch-action: pan-y;");
    expect(appStylesSource).toContain("env(safe-area-inset-top");
    expect(voiceModeSource).not.toContain('<div className="min-h-12" aria-hidden="true" />');
    expect(voiceModeSource).toContain('"grid-cols-3"');
    expect(voiceModeSource).toContain('"grid-cols-2"');
  });

  it("suppresses native bridge payload logging", () => {
    expect(capacitorConfigSource).toContain('loggingBehavior: "none"');
  });
});
