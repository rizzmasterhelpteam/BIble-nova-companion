import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleStop,
  LockKeyhole,
  Mic,
  MicOff,
  Pause,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/apiClient";
import { getPlatformAdapter } from "../../lib/native/platform";
import { cn } from "../../lib/utils";
import { useMobileViewport } from "../../context/MobileViewportContext";
import {
  useGeminiLiveVoice,
  type VoiceStartMode,
} from "../../hooks/useGeminiLiveVoice";
import { usePerformanceMode } from "../../hooks/usePerformanceMode";
import type { VoiceReservation } from "../../lib/voiceReservation";
import type {
  ConversationMessage,
  VoicePlaybackMetadata,
  VoiceState,
} from "../../types/live";
import { VoiceOrb } from "./VoiceOrb";

type VoiceModeProps = {
  userId: string;
  messages: ConversationMessage[];
  shadowNotes: string | null;
  memoryEnabled: boolean;
  isTyping: boolean;
  onAppendUserMessage: (content: string, source?: "voice" | "chat") => void;
  onAppendAssistantMessage: (
    content: string,
    playback: VoicePlaybackMetadata,
  ) => string;
  onUpdateAssistantVoicePlayback: (
    messageId: string,
    playback: VoicePlaybackMetadata,
  ) => void;
  onAcceptShadowNotes: (notes: string | null) => void;
  onExitVoice: () => void;
  onSessionActiveChange: (active: boolean) => void;
  reservation: VoiceReservation | null;
  onReservationChange: (reservation: VoiceReservation | null) => void;
  voiceReady: boolean;
  isCheckingVoiceReady: boolean;
  apiStatusConnectionError?: string;
  onRetryVoiceReady: () => Promise<boolean>;
};

const STATE_HEADLINES: Record<VoiceState, string> = {
  idle: "I'm here.",
  "requesting-permission": "Microphone access",
  connecting: "Opening your reflection",
  ready: "Ready when you are",
  listening: "I'm listening",
  "user-speaking": "Keep going",
  "finishing-user-turn": "I'm with you",
  transcribing: "I heard you",
  thinking: "Reflecting",
  "preparing-voice": "Giving this a voice",
  "assistant-speaking": "Bible Nova is responding",
  "barge-in-listening": "I'm listening",
  interrupted: "Stopped",
  "restarting-listener": "Listening again",
  paused: "Microphone paused",
  reconnecting: "Restoring the conversation",
  ending: "Saving your reflection",
  ended: "Reflection complete",
  "permission-denied": "Microphone unavailable",
  offline: "You're offline",
  error: "Voice is unavailable",
};

const STATE_DESCRIPTIONS: Record<VoiceState, string> = {
  idle: "Speak when you're ready.",
  "requesting-permission": "Your microphone is used only during this conversation.",
  connecting: "This will only take a moment.",
  ready: "You can begin speaking.",
  listening: "Take your time. Tap Done speaking if the pause is not detected.",
  "user-speaking": "Pause when finished, or tap Done speaking.",
  "finishing-user-turn": "Holding your words with care.",
  transcribing: "Understanding what you shared.",
  thinking: "Considering what you shared.",
  "preparing-voice": "Your response is ready in Chat while its voice is prepared.",
  "assistant-speaking": "You can interrupt at any time.",
  "barge-in-listening": "The response stopped. Keep speaking naturally.",
  interrupted: "I'm listening again.",
  "restarting-listener": "Ready for your next thought.",
  paused: "Unmute whenever you are ready to continue.",
  reconnecting: "Your reflection is still here.",
  ending: "Just a moment.",
  ended: "Continue in Chat or begin again.",
  "permission-denied": "Allow microphone access or continue in Chat.",
  offline: "Reconnect to begin a Voice reflection.",
  error: "Retry here or continue with the saved response in Chat.",
};

const isVoiceMessage = (message: ConversationMessage) => message.source === "voice";
const SHADOW_NOTE_PERSIST_INTERVAL_MS = 70_000;
const SHADOW_NOTE_TIMEOUT_MS = 10_000;

export default function VoiceMode({
  userId,
  messages,
  shadowNotes,
  memoryEnabled,
  isTyping,
  onAppendUserMessage,
  onAppendAssistantMessage,
  onUpdateAssistantVoicePlayback,
  onAcceptShadowNotes,
  onExitVoice,
  onSessionActiveChange,
  reservation,
  onReservationChange,
  voiceReady,
  isCheckingVoiceReady,
  apiStatusConnectionError,
  onRetryVoiceReady,
}: VoiceModeProps) {
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const navigate = useNavigate();
  const isPerformanceMode = usePerformanceMode();
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const persistTimerRef = useRef<number | null>(null);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const exitPromiseRef = useRef<Promise<void> | null>(null);
  const messagesRef = useRef(messages);
  const lastPersistedVoiceCountRef = useRef(0);
  const sessionVoiceBaselineRef = useRef(0);
  const lastPersistAttemptAtRef = useRef(0);
  const persistenceBaselineInitializedRef = useRef(false);
  useEffect(() => {
    messagesRef.current = messages;
    if (!persistenceBaselineInitializedRef.current) {
      lastPersistedVoiceCountRef.current = messages.filter(isVoiceMessage).length;
      sessionVoiceBaselineRef.current = lastPersistedVoiceCountRef.current;
      persistenceBaselineInitializedRef.current = true;
    }
  }, [messages]);

  const handleUserTranscript = useCallback((text: string) => {
    onAppendUserMessage(text, "voice");
  }, [onAppendUserMessage]);

  const handleAssistantTranscript = useCallback((
    text: string,
    playback: VoicePlaybackMetadata,
  ) => {
    return onAppendAssistantMessage(text, playback);
  }, [onAppendAssistantMessage]);

  const live = useGeminiLiveVoice({
    userId,
    history: messages,
    shadowNotes,
    onUserTranscript: handleUserTranscript,
    onAssistantTranscript: handleAssistantTranscript,
    onAssistantPlaybackStatusChange: onUpdateAssistantVoicePlayback,
    reservation,
    onReservationChange,
    liveReady: voiceReady,
    apiStatusConnectionError,
    enableInputLevel: !isPerformanceMode,
  });
  const stopLive = live.stop;
  const premiumRequired = live.errorCode === "subscription_required";
  useEffect(() => {
    if (!live.retryUntil) return;
    setCooldownNow(Date.now());
    const timer = window.setInterval(
      () => setCooldownNow(Date.now()),
      live.errorCode === "monthly_limit" ? 60_000 : 1_000,
    );
    return () => window.clearInterval(timer);
  }, [live.errorCode, live.retryUntil]);
  const cooldownSeconds = live.retryUntil
    ? Math.max(0, Math.ceil((live.retryUntil - cooldownNow) / 1_000))
    : 0;
  const cooldownActive =
    (live.errorCode === "session_active" ||
      live.errorCode === "daily_limit" ||
      live.errorCode === "monthly_limit") &&
    cooldownSeconds > 0;
  const cooldownMinutes = Math.max(1, Math.ceil(cooldownSeconds / 60));
  const persistVoiceNotes = useCallback((force = false) => {
    const persistLatestConfirmedMessages = async () => {
      if (!memoryEnabled) return;
      const voiceMessages = messagesRef.current.filter(isVoiceMessage);
      if (!voiceMessages.length || voiceMessages.length === lastPersistedVoiceCountRef.current) return;
      const voiceMessageCount = voiceMessages.length;
      const sessionVoiceMessageCount = voiceMessageCount - sessionVoiceBaselineRef.current;
      const hasCompletedTurn = sessionVoiceMessageCount >= 2 && sessionVoiceMessageCount % 2 === 0;
      if (!hasCompletedTurn) return;
      if (!force && Date.now() - lastPersistAttemptAtRef.current < SHADOW_NOTE_PERSIST_INTERVAL_MS) return;
      const noteMessages = messagesRef.current
        .slice(-12)
        .map(({ role, content }) => ({ role, content }));

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), SHADOW_NOTE_TIMEOUT_MS);
      lastPersistAttemptAtRef.current = Date.now();
      try {
        const response = await apiFetch("/api/voice/shadow-notes", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: noteMessages,
            shadowNotes,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          memoryEnabled?: boolean;
          shadowNotes?: string | null;
        };
        if (response.ok) {
          if (data.memoryEnabled !== false && typeof data.shadowNotes === "string" && data.shadowNotes.trim()) {
            onAcceptShadowNotes(data.shadowNotes);
          }
          lastPersistedVoiceCountRef.current = voiceMessageCount;
        }
      } catch {
        // Voice remains usable if note persistence is temporarily unavailable.
      } finally {
        window.clearTimeout(timeout);
      }
    };

    const queuedPersistence = persistQueueRef.current
      .catch(() => undefined)
      .then(persistLatestConfirmedMessages);
    persistQueueRef.current = queuedPersistence;
    return queuedPersistence;
  }, [memoryEnabled, onAcceptShadowNotes, shadowNotes]);
  const latestPersistVoiceNotesRef = useRef(persistVoiceNotes);
  useEffect(() => {
    latestPersistVoiceNotesRef.current = persistVoiceNotes;
  }, [persistVoiceNotes]);

  useEffect(() => {
    if (!memoryEnabled) return;
    const voiceMessageCount = messages.filter(isVoiceMessage).length;
    const sessionVoiceMessageCount = voiceMessageCount - sessionVoiceBaselineRef.current;
    if (
      !voiceMessageCount ||
      voiceMessageCount === lastPersistedVoiceCountRef.current ||
      sessionVoiceMessageCount < 2 ||
      sessionVoiceMessageCount % 2 !== 0
    ) return;
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void persistVoiceNotes();
    }, SHADOW_NOTE_PERSIST_INTERVAL_MS);

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [memoryEnabled, messages, persistVoiceNotes]);

  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    void latestPersistVoiceNotesRef.current(true);
  }, []);

  const active = live.isSessionActive;
  useEffect(() => {
    onSessionActiveChange(active);
  }, [active, onSessionActiveChange]);
  useEffect(() => () => onSessionActiveChange(false), [onSessionActiveChange]);

  const handleEnd = useCallback(async () => {
    await stopLive("ended", "user_end");
    void persistVoiceNotes(true);
  }, [persistVoiceNotes, stopLive]);

  const handleStart = useCallback(async (requestedMode?: VoiceStartMode) => {
    // Android requires audio to be activated directly from the tap. Do this
    // before a status retry yields to the network or the Capacitor bridge.
    live.primeAudioForUserGesture();
    let ready = voiceReady;
    const shouldRefreshStatus =
      !ready ||
      live.state === "error" ||
      live.state === "permission-denied" ||
      live.state === "offline";
    if (shouldRefreshStatus) {
      const refreshedReady = await onRetryVoiceReady();
      ready = refreshedReady || ready;
    }
    if (ready) {
      await live.start(
        requestedMode || (live.canRecover ? "recovery_resume" : "fresh_start"),
      );
    }
  }, [
    live.canRecover,
    live.primeAudioForUserGesture,
    live.start,
    onRetryVoiceReady,
    voiceReady,
  ]);

  const handleExitVoice = useCallback(() => {
    if (exitPromiseRef.current) return exitPromiseRef.current;

    const exitPromise = (async () => {
      await stopLive("ended", "user_exit");
      onExitVoice();
      void persistVoiceNotes(true);
    })();
    exitPromiseRef.current = exitPromise;
    const clearExitPromise = () => {
      if (exitPromiseRef.current === exitPromise) exitPromiseRef.current = null;
    };
    void exitPromise.then(clearExitPromise, clearExitPromise);
    return exitPromise;
  }, [onExitVoice, persistVoiceNotes, stopLive]);

  useEffect(() => {
    const platform = getPlatformAdapter();
    if (!active || !platform.isNative) return;
    // A hardware back press ends the active microphone session but keeps
    // the user in Voice Mode. Moving to text chat remains explicit.
    return platform.backButton.subscribe(() => void handleEnd());
  }, [active, handleEnd]);

  const startLabel = premiumRequired
    ? "Recheck premium access"
    : live.errorCode === "monthly_limit"
      ? "Monthly Voice limit reached"
    : cooldownActive
      ? `Available in ${cooldownMinutes} min`
      : isCheckingVoiceReady
        ? "Retry Voice"
        : live.state === "permission-denied"
          ? "Try microphone again"
          : live.state === "offline"
            ? "Reconnect and retry"
            : !voiceReady || live.state === "error"
              ? "Try Voice again"
              : live.canRecover
                ? "Resume interrupted reflection"
                : live.state === "ended"
                ? "Begin another reflection"
                : "Start voice reflection";
  const showStartButton = !active;
  const canControlMicrophone = [
    "ready",
    "listening",
    "user-speaking",
    "finishing-user-turn",
    "transcribing",
    "thinking",
    "preparing-voice",
    "assistant-speaking",
    "barge-in-listening",
    "interrupted",
    "restarting-listener",
    "paused",
  ].includes(live.state);
  const showRetryableSessionError =
    active &&
    ["error", "permission-denied", "offline", "reconnecting"].includes(live.state);
  const sessionNotice = premiumRequired
    ? live.error || "We could not confirm your premium plan yet. Restore it with Google Play and try Voice again."
    : !isCheckingVoiceReady && !voiceReady
      ? apiStatusConnectionError || "Voice mode is temporarily unavailable. You can retry the connection or continue in Chat."
    : live.error || live.sessionNotice;
  const sessionNoticeIsError = Boolean(live.error) || (!isCheckingVoiceReady && !voiceReady);
  return (
    <div className="voice-mode relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
      {active && (
        <button
          type="button"
          onClick={() => void handleEnd()}
          aria-label="End Voice session"
          className="voice-session-close touch-target absolute right-4 top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:right-6 sm:top-6"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">End Voice session</span>
        </button>
      )}
      <div className={cn(
        "voice-scroll-region app-scroll-region flex min-h-0 flex-1 flex-col scrollbar-hide",
        isCompactPhone ? "px-4 py-3" : "px-5 py-4 sm:px-6 sm:py-6",
      )}>
        <main className="voice-content mx-auto flex min-h-0 w-full max-w-[680px] flex-1 flex-col">
          <div className={cn(
            "voice-hero flex min-h-0 flex-1 flex-col justify-center",
            isShortPhone ? "py-2" : "py-6 sm:py-10",
          )}>
            <div className="flex flex-col items-center text-center">
              <VoiceOrb
                state={live.state}
                inputLevel={live.inputLevel}
                isPerformanceMode={isPerformanceMode}
                compact={isShortPhone}
                className="mb-5"
              />

              <motion.div
                key={live.state}
                className="voice-status-copy flex flex-col items-center"
                initial={isPerformanceMode ? false : { opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={isPerformanceMode
                  ? { duration: 0 }
                  : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                <h2 className="voice-state-title app-heading max-w-[20ch] font-serif text-[clamp(2rem,10vw,2.375rem)] font-semibold leading-tight tracking-[-0.02em] sm:text-[48px]">
                  {STATE_HEADLINES[live.state]}
                </h2>
                <p className="voice-state-description app-muted mt-2 max-w-md text-[15px] leading-relaxed sm:text-[17px]">
                  {STATE_DESCRIPTIONS[live.state]}
                </p>
              </motion.div>

            </div>
          </div>

          {sessionNotice && (
            <div
              role={sessionNoticeIsError ? "alert" : "status"}
              aria-live={sessionNoticeIsError ? "assertive" : "polite"}
              className="voice-session-notice mt-3 flex w-full items-start gap-2.5 rounded-[1rem] border px-3.5 py-3 text-left text-sm leading-relaxed"
              style={{
                background: sessionNoticeIsError ? "var(--app-danger-soft)" : "var(--app-accent-soft)",
                borderColor: sessionNoticeIsError ? "color-mix(in srgb, var(--app-danger) 22%, transparent)" : "color-mix(in srgb, var(--app-accent) 22%, transparent)",
                color: sessionNoticeIsError ? "var(--app-danger)" : "var(--app-text)",
              }}
            >
              {sessionNoticeIsError
                ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                : <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
              <span>{sessionNotice}</span>
            </div>
          )}

          <div className={cn("voice-actions mt-4 w-full pb-safe", isShortPhone ? "pt-1" : "pt-2")}>
            {showStartButton ? (
              <div className="flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={() => void handleStart()}
                  disabled={isTyping || cooldownActive}
                  aria-busy={isCheckingVoiceReady}
                  className="voice-primary-action touch-target app-primary-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-pill px-5 text-[15px] font-semibold transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {premiumRequired ? <RotateCcw className="h-5 w-5" /> : live.state === "error" || live.state === "permission-denied" || live.state === "offline" ? <RotateCcw className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                  {startLabel}
                </button>
                {live.canRecover && (
                  <button
                    type="button"
                    onClick={() => void handleStart("fresh_start")}
                    disabled={isTyping || cooldownActive}
                    className="voice-control-button touch-target app-secondary-button inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-pill px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Sparkles className="h-4 w-4" />
                    Start a fresh reflection
                  </button>
                )}
              </div>
            ) : showRetryableSessionError ? (
              <div className="grid w-full grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => void live.retry()}
                  className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[12px] font-medium"
                >
                  <RotateCcw className="h-4 w-4" />
                  <span>{live.retryLabel}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExitVoice()}
                  className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[12px] font-medium"
                >
                  <Send className="h-4 w-4" />
                  <span>Continue in Chat</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleEnd()}
                  className="voice-control-button voice-end-button touch-target flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] border px-2 text-[12px] font-medium"
                  style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", background: "var(--app-danger-soft)" }}
                >
                  <CircleStop className="h-4 w-4" />
                  <span>End</span>
                </button>
              </div>
            ) : canControlMicrophone ? (
              <div className={cn(
                "grid w-full gap-2",
                live.state === "assistant-speaking" ||
                  live.state === "listening" ||
                  live.state === "user-speaking"
                  ? "grid-cols-3"
                  : "grid-cols-2",
              )}>
                <button
                  type="button"
                  onClick={() => {
                    if (live.isVisibilityPaused) void live.resume();
                    else live.toggleMute();
                  }}
                  aria-label={live.isVisibilityPaused ? "Resume Voice" : live.isMuted ? "Unmute microphone" : "Mute microphone"}
                  className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[13px] font-medium"
                >
                  {live.isVisibilityPaused || !live.isMuted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                  <span>{live.isVisibilityPaused ? "Resume Voice" : live.isMuted ? "Unmute" : "Mute"}</span>
                </button>
                {live.state === "assistant-speaking" ? (
                  <button
                    type="button"
                    onClick={live.interrupt}
                    aria-label="Stop assistant audio"
                    className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[13px] font-medium"
                  >
                    <Pause className="h-4 w-4" />
                    <span>Stop audio</span>
                  </button>
                ) : live.state === "listening" || live.state === "user-speaking" ? (
                  <button
                    type="button"
                    onClick={live.finishTurn}
                    aria-label="Done speaking"
                    className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[13px] font-medium"
                  >
                    <Send className="h-4 w-4" />
                    <span>Done speaking</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleEnd()}
                  aria-label="End voice conversation"
                  className="voice-control-button voice-end-button touch-target flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] border px-2 text-[13px] font-medium"
                  style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", background: "var(--app-danger-soft)" }}
                >
                  <CircleStop className="h-4 w-4" />
                  <span>End</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handleEnd()}
                disabled={live.state === "ending"}
                className="voice-control-button voice-end-button touch-target flex min-h-12 w-full items-center justify-center gap-2 rounded-[1rem] border px-4 text-[14px] font-medium disabled:cursor-wait disabled:opacity-70"
                style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", background: "var(--app-danger-soft)" }}
              >
                <CircleStop className="h-4 w-4" />
                <span>{live.state === "ending" ? "Ending…" : "Cancel Voice start"}</span>
              </button>
            )}

            {premiumRequired && (
              <button
                type="button"
                onClick={() => navigate("/paywall")}
                className="touch-target app-muted mt-3 w-full rounded-pill px-4 py-2 text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                Manage premium plan
              </button>
            )}

            {isTyping && <p className="app-muted mt-1 text-center text-xs">Finishing your previous reflection...</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
