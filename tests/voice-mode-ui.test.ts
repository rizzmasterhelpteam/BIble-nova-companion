import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const voiceModeSource = source("../src/components/voice/VoiceMode.tsx");
const chatSource = source("../src/pages/Chat.tsx");
const voiceHookSource = source("../src/hooks/useGeminiLiveVoice.ts");
const voiceOrbSource = source("../src/components/voice/VoiceOrb.tsx");
const voiceSessionSource = source("../api/voice/session.ts");
const subscriptionSyncSource = source("../src/lib/native/subscriptionSync.ts");
const appStylesSource = source("../src/index.css");
const capacitorConfigSource = source("../capacitor.config.ts");
const androidManifestSource = source("../android/app/src/main/AndroidManifest.xml");
const fileProviderPathsSource = source("../android/app/src/main/res/xml/file_paths.xml");

describe("Voice mode interface", () => {
  it("uses Gemini Live only for immersive Voice", () => {
    expect(voiceModeSource).toContain("useGeminiLiveVoice");
    expect(voiceModeSource).not.toContain("useTurnBasedVoice");
    expect(voiceHookSource).toContain('apiFetch("/api/voice/session"');
    expect(voiceHookSource).toContain('action: "live-token"');
    expect(voiceHookSource).toContain("sendRealtimeInput({");
    expect(voiceHookSource).toContain("audio/pcm;rate=${GEMINI_INPUT_SAMPLE_RATE}");
    expect(voiceHookSource).not.toContain('apiFetch("/api/transcribe"');
    expect(voiceHookSource).not.toContain('apiFetch("/api/voice/respond"');
    expect(voiceHookSource).not.toContain('apiFetch("/api/tts"');
  });

  it("does not render a Voice caption control while captions are deferred", () => {
    expect(voiceModeSource).not.toContain("voice-transcript");
    expect(voiceModeSource).not.toContain("voice-captions-toggle");
    expect(voiceModeSource).not.toContain("bible-nova-voice-captions");
    expect(voiceModeSource).not.toContain("Voice language");
    expect(voiceModeSource).not.toContain("VOICE_LANGUAGE_OPTIONS");
  });

  it("renders calm, distinct visuals for active Voice states", () => {
    expect(voiceModeSource).toContain("<VoiceOrb");
    expect(voiceModeSource).toContain("inputLevel={live.inputLevel}");
    expect(voiceOrbSource).toContain('listening: "listening"');
    expect(voiceOrbSource).toContain('"user-speaking": "user-speaking"');
    expect(voiceOrbSource).toContain('"assistant-speaking": "assistant-speaking"');
    expect(voiceOrbSource).toContain('thinking: "reflecting"');
  });

  it("limits audio feedback work on performance-mode devices", () => {
    expect(voiceModeSource).toContain("enableInputLevel: !isPerformanceMode");
    expect(voiceHookSource).toContain("INPUT_LEVEL_UPDATE_INTERVAL_MS = 90");
    expect(voiceHookSource).toContain("setInputLevel(Number(Math.min(1, peak * 4)");
    expect(voiceOrbSource).toContain("voice-orb--performance");
    expect(appStylesSource).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("primes Android audio before readiness retry and starts when recovered", () => {
    const primeIndex = voiceModeSource.indexOf("live.primeAudioForUserGesture();");
    const retryIndex = voiceModeSource.indexOf("const refreshedReady = await onRetryVoiceReady();");
    expect(primeIndex).toBeGreaterThan(-1);
    expect(retryIndex).toBeGreaterThan(primeIndex);
    expect(voiceModeSource).toContain("ready = refreshedReady || ready;");
    expect(voiceModeSource).toContain("await live.start(");
  });

  it("keeps chat speech diagnostics independent from Voice retry", () => {
    expect(chatSource).toContain('void refreshSpeechSupport("api-status-retry");');
    expect(chatSource).not.toContain('await refreshSpeechSupport("api-status-retry");');
  });

  it("reserves premium Voice time before minting a Live token", () => {
    expect(voiceHookSource).toContain('apiFetch("/api/voice/session"');
    expect(voiceHookSource).toContain('action: "live-token"');
    expect(voiceHookSource).toContain("await provisionAndConnect(null)");
    expect(voiceHookSource).toContain("createVoiceReservation");
    expect(voiceSessionSource).toContain('availability.reason === "reservation_resume"');
  });

  it("repairs native premium access only after eligibility rejects it", () => {
    const eligibilityIndex = voiceHookSource.indexOf("let response = await requestSession();");
    const repairIndex = voiceHookSource.indexOf("refreshNativeSubscriptionEntitlement");
    const retryIndex = voiceHookSource.lastIndexOf("response = await requestSession();");
    expect(repairIndex).toBeGreaterThan(eligibilityIndex);
    expect(retryIndex).toBeGreaterThan(repairIndex);
    expect(subscriptionSyncSource).toContain("selectNewestConfiguredNativePurchase");
  });

  it("uses processed microphone PCM and streaming playback", () => {
    expect(voiceHookSource).toContain("navigator.mediaDevices.getUserMedia({");
    expect(voiceHookSource).toContain("echoCancellation: true");
    expect(voiceHookSource).toContain("noiseSuppression: true");
    expect(voiceHookSource).toContain("autoGainControl: true");
    expect(voiceHookSource).toContain("audioStreamEnd: true");
    expect(voiceHookSource).toContain("GeminiPcmPlaybackQueue");
  });

  it("handles interruption, bounded reconnects, and safe cleanup", () => {
    expect(voiceHookSource).toContain("content?.interrupted");
    expect(voiceHookSource).toContain("MAX_RECONNECT_ATTEMPTS");
    expect(voiceHookSource).toContain("sessionResumption");
    expect(voiceHookSource).toContain("suppressPlaybackRef.current = true");
    expect(voiceHookSource).toContain("stopMicrophone()");
    expect(voiceHookSource).toContain("clearPlayback(false)");
    expect(voiceHookSource).toContain("await releaseReservation(");
    expect(voiceHookSource).toContain("await targetContext.close()");
    const resetIndex = voiceHookSource.indexOf("reconnectAttemptsRef.current = 0");
    const goAwayIndex = voiceHookSource.indexOf("if (message.goAway)");
    expect(resetIndex).toBeGreaterThan(goAwayIndex);
  });

  it("routes microphone PCM to the current session after reconnecting", () => {
    expect(voiceHookSource).toContain("createCurrentSessionRouter");
    expect(voiceHookSource).toContain("microphoneRouterRef.current.send");
    expect(voiceHookSource).not.toContain("startMicrophone(connectedSession)");
    expect(voiceHookSource).toContain("reconnectPromiseRef.current");
    expect(voiceHookSource).toContain("clearPlayback(true);");
    expect(voiceHookSource).toContain("window.clearTimeout(reconnectTimerRef.current);");
    expect(voiceHookSource).toContain("visibilityPaused: webVisibilityPausedRef.current");
  });

  it("honors the server idle timeout and suspends microphone processing in the background", () => {
    expect(voiceHookSource).toContain("idleTimeoutSeconds?: number");
    expect(voiceHookSource).toContain('stop("ended", "idle_timeout")');
    expect(voiceHookSource).toContain("void contextRef.current?.suspend()");
    expect(voiceHookSource).toContain("await navigator.mediaDevices.getUserMedia({");
  });

  it("keeps provider and premium failures recoverable inside Voice Mode", () => {
    expect(voiceHookSource).not.toContain("Confirming premium access");
    expect(voiceModeSource).toContain("showRetryableSessionError");
    expect(voiceModeSource).toContain("Continue in Chat");
    expect(voiceModeSource).toContain("Recheck premium access");
    expect(voiceHookSource).toContain('"monthly_limit"');
  });

  it("does not embed a Gemini key or log private Voice payloads", () => {
    expect(voiceHookSource).not.toContain("GEMINI_API_KEY");
    expect(voiceHookSource).not.toMatch(/console\.(?:log|info|debug)\([^\n]*(?:transcript|shadowNotes|audioData)/i);
  });

  it("keeps actions safe-area aware and suppresses bridge payload logging", () => {
    expect(appStylesSource).toContain("overflow-y: auto;");
    expect(appStylesSource).toContain("env(safe-area-inset-top");
    expect(capacitorConfigSource).toContain('loggingBehavior: "none"');
  });

  it("disables Android backups and does not expose the full external storage through FileProvider", () => {
    expect(androidManifestSource).toContain('android:allowBackup="false"');
    expect(fileProviderPathsSource).not.toContain("<external-path");
  });
});
