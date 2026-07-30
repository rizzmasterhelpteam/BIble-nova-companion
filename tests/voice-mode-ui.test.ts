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
const voiceOrbSource = readFileSync(
  new URL("../src/components/voice/VoiceOrb.tsx", import.meta.url),
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

  it("renders calm, distinct visuals for each active Voice state", () => {
    expect(voiceModeSource).toContain("<VoiceOrb");
    expect(voiceModeSource).toContain("inputLevel={live.inputLevel}");
    expect(voiceOrbSource).toContain('listening: "listening"');
    expect(voiceOrbSource).toContain('"user-speaking": "user-speaking"');
    expect(voiceOrbSource).toContain('"assistant-speaking": "assistant-speaking"');
    expect(voiceOrbSource).toContain('thinking: "reflecting"');
    expect(voiceOrbSource).toContain("voice-listening-ring");
    expect(voiceOrbSource).toContain("voice-wave-halo");
    expect(voiceOrbSource).toContain("voice-thinking-halo");
    expect(voiceOrbSource).toContain("voice-assistant-ripple");
  });

  it("throttles audio-reactive feedback and simplifies motion on Android", () => {
    expect(voiceModeSource).toContain("enableInputLevel: !isPerformanceMode");
    expect(voiceHookSource).toContain("INPUT_LEVEL_UPDATE_INTERVAL_MS = 90");
    expect(voiceHookSource).toContain("publishInputLevel(rms)");
    expect(voiceOrbSource).toContain("voice-orb--performance");
    expect(voiceOrbSource).toContain("!isPerformanceMode &&");
    expect(appStylesSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(appStylesSource).toContain(".voice-page .voice-orb *");
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

  it("does not show premium verification as the normal Voice Mode startup status", () => {
    expect(voiceHookSource).not.toContain("Confirming premium access");
    expect(voiceHookSource).not.toContain("Rechecking your Google Play premium access");
    expect(voiceHookSource).toContain("Connecting to your voice session");
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

  it("supports Auto, English, Hindi, and Hinglish without forcing Whisper to English", () => {
    expect(voiceModeSource).toContain("Voice language");
    expect(voiceModeSource).toContain("VOICE_LANGUAGE_OPTIONS");
    expect(voiceHookSource).toContain("getWhisperLanguage(selectedVoiceLanguage)");
    expect(voiceHookSource).toContain("voiceLanguage: voiceLanguageRef.current");
  });

  it("shows server-calculated monthly Voice time and clearly handles its limit", () => {
    expect(voiceModeSource).toContain("Voice this month");
    expect(voiceModeSource).toContain("monthlyUsagePercent >= 80");
    expect(voiceModeSource).toContain("monthlyUsagePercent >= 95");
    expect(voiceModeSource).toContain("Monthly Voice limit reached");
    expect(voiceHookSource).toContain('"monthly_limit"');
    expect(voiceHookSource).toContain("idle_timeout");
  });

  it("restarts cleanly after a no-speech timeout instead of sending empty audio", () => {
    expect(voiceHookSource).toContain("NO_SPEECH_TIMEOUT_MS");
    expect(voiceHookSource).toContain("I'm still listening—start whenever you're ready.");
    expect(voiceHookSource).toContain("pendingNoSpeechRestartOperationRef");
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
    expect(voiceHookSource).toContain("stopVoicePlaybackSource");
    expect(voiceHookSource).toContain("applyVoicePlaybackFadeIn");
    expect(voiceHookSource).toContain("playbackGainRef");
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
    expect(voiceHookSource).toContain("bargeInDetectorRef.current.beginPlayback()");
    expect(voiceHookSource).toContain("barge_in_preroll_started");
    expect(voiceHookSource).toContain("bargeInPreRollUsed");
    expect(voiceHookSource).toContain("auto_barge_in_paused");
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
