import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  CircleStop,
  LockKeyhole,
  Mic,
  MicOff,
  Pause,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/apiClient";
import { isNativePlatform } from "../../lib/native/platform";
import { cn } from "../../lib/utils";
import { useMobileViewport } from "../../context/MobileViewportContext";
import { useGeminiLive } from "../../hooks/useGeminiLive";
import { usePerformanceMode } from "../../hooks/usePerformanceMode";
import type { ConversationMessage, VoiceState } from "../../types/live";

type VoiceModeProps = {
  messages: ConversationMessage[];
  shadowNotes: string | null;
  isTyping: boolean;
  onAppendUserMessage: (content: string, source?: "voice" | "chat") => void;
  onAppendAssistantMessage: (content: string) => void;
  onAcceptShadowNotes: (notes: string | null) => void;
  onExitVoice: () => void;
  onSessionActiveChange: (active: boolean) => void;
  reservation: { handle: string; expiresAt: string } | null;
  onReservationChange: (reservation: { handle: string; expiresAt: string } | null) => void;
  liveReady: boolean;
  isCheckingLiveReady: boolean;
  apiStatusConnectionError?: string;
  onRetryLiveReady: () => Promise<boolean>;
};

const STATE_HEADLINES: Record<VoiceState, string> = {
  idle: "I'm here.",
  "requesting-permission": "Microphone access",
  connecting: "Opening your reflection",
  ready: "Ready when you are",
  listening: "I'm listening",
  "user-speaking": "Keep going",
  thinking: "Reflecting",
  "assistant-speaking": "Bible Nova is responding",
  interrupted: "Stopped",
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
  listening: "Take your time.",
  "user-speaking": "There is no need to rush.",
  thinking: "Considering what you shared.",
  "assistant-speaking": "You can interrupt at any time.",
  interrupted: "I'm listening again.",
  reconnecting: "Your reflection is still here.",
  ending: "Just a moment.",
  ended: "Continue in Chat or begin again.",
  "permission-denied": "Allow microphone access or continue in Chat.",
  offline: "Reconnect to begin a Voice reflection.",
  error: "Chat remains available.",
};

const ACTIVE_STATES: VoiceState[] = [
  "requesting-permission",
  "connecting",
  "ready",
  "listening",
  "user-speaking",
  "thinking",
  "assistant-speaking",
  "interrupted",
  "reconnecting",
  "ending",
];

const isVoiceMessage = (message: ConversationMessage) => message.source === "voice";
const SHADOW_NOTE_PERSIST_INTERVAL_MS = 70_000;
const SHADOW_NOTE_TIMEOUT_MS = 2_500;

export default function VoiceMode({
  messages,
  shadowNotes,
  isTyping,
  onAppendUserMessage,
  onAppendAssistantMessage,
  onAcceptShadowNotes,
  onExitVoice,
  onSessionActiveChange,
  reservation,
  onReservationChange,
  liveReady,
  isCheckingLiveReady,
  apiStatusConnectionError,
  onRetryLiveReady,
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

  const handleAssistantTranscript = useCallback((text: string) => {
    onAppendAssistantMessage(text);
  }, [onAppendAssistantMessage]);

  const live = useGeminiLive({
    history: messages,
    onUserTranscript: handleUserTranscript,
    onAssistantTranscript: handleAssistantTranscript,
    reservation,
    onReservationChange,
    liveReady,
    apiStatusConnectionError,
  });
  const stopLive = live.stop;
  const premiumRequired = live.errorCode === "subscription_required";
  useEffect(() => {
    if (!live.retryUntil) return;
    setCooldownNow(Date.now());
    const timer = window.setInterval(() => setCooldownNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live.retryUntil]);
  const cooldownSeconds = live.retryUntil
    ? Math.max(0, Math.ceil((live.retryUntil - cooldownNow) / 1_000))
    : 0;
  const cooldownActive =
    (live.errorCode === "session_active" || live.errorCode === "daily_limit") &&
    cooldownSeconds > 0;
  const cooldownMinutes = Math.max(1, Math.ceil(cooldownSeconds / 60));

  const persistVoiceNotes = useCallback((force = false) => {
    const persistLatestConfirmedMessages = async () => {
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
        const response = await apiFetch("/api/live/shadow-notes", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: noteMessages,
            shadowNotes,
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { shadowNotes?: string | null };
        if (response.ok) {
          if (typeof data.shadowNotes === "string" && data.shadowNotes.trim()) {
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
  }, [onAcceptShadowNotes, shadowNotes]);
  const latestPersistVoiceNotesRef = useRef(persistVoiceNotes);
  useEffect(() => {
    latestPersistVoiceNotesRef.current = persistVoiceNotes;
  }, [persistVoiceNotes]);

  useEffect(() => {
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
  }, [messages, persistVoiceNotes]);

  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    void latestPersistVoiceNotesRef.current(true);
  }, []);

  const active = ACTIVE_STATES.includes(live.state);
  useEffect(() => {
    onSessionActiveChange(active);
  }, [active, onSessionActiveChange]);
  useEffect(() => () => onSessionActiveChange(false), [onSessionActiveChange]);

  const presenceShouldMove = !isPerformanceMode && active && live.state !== "ending";
  const isSpeaking = live.state === "user-speaking" || live.state === "assistant-speaking";

  const handleEnd = useCallback(async () => {
    await stopLive("ended");
    void persistVoiceNotes(true);
  }, [persistVoiceNotes, stopLive]);

  const handleStart = useCallback(async () => {
    // Android requires audio to be activated directly from the tap. Do this
    // before a status retry yields to the network or the Capacitor bridge.
    live.primeAudioForUserGesture();
    let ready = liveReady;
    const shouldRefreshStatus =
      !ready ||
      live.state === "error" ||
      live.state === "permission-denied" ||
      live.state === "offline";
    if (shouldRefreshStatus) {
      const refreshedReady = await onRetryLiveReady();
      ready = refreshedReady || ready;
    }
    if (ready) await live.start();
  }, [live.primeAudioForUserGesture, live.start, liveReady, onRetryLiveReady]);

  const handleExitVoice = useCallback(() => {
    if (exitPromiseRef.current) return exitPromiseRef.current;

    const exitPromise = (async () => {
      await stopLive("ended");
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
    if (!active || !isNativePlatform()) return;

    let disposed = false;
    let listener: { remove: () => Promise<void> } | null = null;
    void import("@capacitor/app")
      .then(({ App }) => App.addListener("backButton", () => {
        void handleExitVoice();
      }))
      .then((handle) => {
        if (disposed) void handle.remove();
        else listener = handle;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      if (listener) void listener.remove();
    };
  }, [active, handleExitVoice]);

  const startLabel = premiumRequired
    ? "Recheck premium access"
    : cooldownActive
      ? `Available in ${cooldownMinutes} min`
      : isCheckingLiveReady
        ? "Retry Voice"
        : live.state === "permission-denied"
          ? "Try microphone again"
          : live.state === "offline"
            ? "Reconnect and retry"
            : !liveReady || live.state === "error"
              ? "Try Voice again"
              : live.state === "ended"
                ? "Begin another reflection"
                : "Start voice reflection";
  const showStartButton = !active;
  const canControlMicrophone = [
    "ready",
    "listening",
    "user-speaking",
    "thinking",
    "assistant-speaking",
    "interrupted",
  ].includes(live.state);
  const sessionNotice = premiumRequired
    ? live.error || "We could not confirm your premium plan yet. Restore it with Google Play and try Voice again."
    : !isCheckingLiveReady && !liveReady
      ? apiStatusConnectionError || "Voice mode is temporarily unavailable. You can retry the connection or continue in Chat."
    : live.error || live.sessionNotice;
  const sessionNoticeIsError = Boolean(live.error) || (!isCheckingLiveReady && !liveReady);

  return (
    <div className="voice-mode relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
      {active && (
        <button
          type="button"
          onClick={() => void handleExitVoice()}
          aria-label="Exit Voice and continue in Chat"
          className="voice-session-close touch-target absolute right-4 top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:right-6 sm:top-6"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Exit Voice and continue in Chat</span>
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
            <div className="flex flex-col items-center text-center" aria-live="polite">
              <div
                className="voice-privacy-pill mb-5 inline-flex min-h-8 items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-medium"
                style={{
                  color: "var(--app-text-muted)",
                  background: "var(--app-surface-muted)",
                  borderColor: "var(--app-card-border)",
                }}
              >
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Saved to Chat; continuity notes stay private to your account</span>
              </div>

              <div className={cn(
                "voice-presence relative mb-5 flex items-center justify-center",
                isShortPhone ? "h-[128px] w-[128px]" : "h-36 w-36 sm:h-40 sm:w-40",
              )}>
                {presenceShouldMove && (
                  <motion.div
                    aria-hidden="true"
                    className="voice-presence-ring absolute inset-0 rounded-full border"
                    animate={{ scale: [1, 1.035, 1], opacity: [0.45, 0.88, 0.45] }}
                    transition={{ duration: live.state === "assistant-speaking" ? 1.2 : 2.8, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
                <div
                  className="voice-presence-core relative flex h-24 w-24 items-center justify-center rounded-full border sm:h-28 sm:w-28"
                >
                  <Mic className="h-10 w-10 sm:h-12 sm:w-12" strokeWidth={1.5} aria-hidden="true" />
                </div>
                {isSpeaking && (
                  <div className="absolute -bottom-1 flex h-4 items-end gap-1" aria-hidden="true">
                    {[0, 1, 2].map((bar) => (
                      <motion.span
                        key={bar}
                        className="voice-audio-bar w-1 rounded-pill"
                        animate={isPerformanceMode ? { height: 8 } : { height: [6, 14, 8, 6] }}
                        transition={isPerformanceMode ? { duration: 0 } : { duration: 0.8, delay: bar * 0.12, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <h2 className="voice-state-title app-heading max-w-[20ch] font-serif text-[clamp(2rem,10vw,2.375rem)] font-semibold leading-tight tracking-[-0.02em] sm:text-[48px]">
                {STATE_HEADLINES[live.state]}
              </h2>
              <p className="voice-state-description app-muted mt-2 max-w-md text-[15px] leading-relaxed sm:text-[17px]">
                {STATE_DESCRIPTIONS[live.state]}
              </p>
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
              <button
                type="button"
                onClick={() => void handleStart()}
                disabled={isTyping || cooldownActive}
                aria-busy={isCheckingLiveReady}
                className="voice-primary-action touch-target app-primary-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-pill px-5 text-[15px] font-semibold transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {premiumRequired ? <RotateCcw className="h-5 w-5" /> : live.state === "error" || live.state === "permission-denied" || live.state === "offline" ? <RotateCcw className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                {startLabel}
              </button>
            ) : canControlMicrophone ? (
              <div className={cn(
                "grid w-full gap-2",
                live.state === "assistant-speaking" ? "grid-cols-3" : "grid-cols-2",
              )}>
                <button
                  type="button"
                  onClick={live.toggleMute}
                  aria-label={live.isMuted ? "Unmute microphone" : "Mute microphone"}
                  className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[13px] font-medium"
                >
                  {live.isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                  <span>{live.isMuted ? "Unmute" : "Mute"}</span>
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
