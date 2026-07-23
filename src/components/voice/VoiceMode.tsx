import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  CircleStop,
  LockKeyhole,
  MessageCircle,
  Mic,
  MicOff,
  Pause,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/apiClient";
import { cn } from "../../lib/utils";
import { useMobileViewport } from "../../context/MobileViewportContext";
import { useGeminiLive } from "../../hooks/useGeminiLive";
import type { ConversationMessage, VoiceState } from "../../types/live";

type VoiceModeProps = {
  messages: ConversationMessage[];
  shadowNotes: string | null;
  isTyping: boolean;
  onAppendUserMessage: (content: string, source?: "voice" | "chat") => void;
  onAppendAssistantMessage: (content: string) => void;
  onAcceptShadowNotes: (notes: string | null) => void;
  onContinueInChat: () => void;
  onExitVoice: () => void;
  onSessionActiveChange: (active: boolean) => void;
  reservation: { handle: string; expiresAt: string } | null;
  onReservationChange: (reservation: { handle: string; expiresAt: string } | null) => void;
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

export default function VoiceMode({
  messages,
  shadowNotes,
  isTyping,
  onAppendUserMessage,
  onAppendAssistantMessage,
  onAcceptShadowNotes,
  onContinueInChat,
  onExitVoice,
  onSessionActiveChange,
  reservation,
  onReservationChange,
}: VoiceModeProps) {
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const [showCaptions, setShowCaptions] = useState(true);
  const [cooldownNow, setCooldownNow] = useState(() => Date.now());
  const persistTimerRef = useRef<number | null>(null);
  const messagesRef = useRef(messages);
  const lastPersistedVoiceCountRef = useRef(0);

  useEffect(() => {
    messagesRef.current = messages;
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
  });
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

  const persistVoiceNotes = useCallback(async () => {
    const voiceMessages = messagesRef.current.filter(isVoiceMessage);
    if (!voiceMessages.length || voiceMessages.length === lastPersistedVoiceCountRef.current) return;

    try {
      const response = await apiFetch("/api/live/shadow-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messagesRef.current.slice(-12).map(({ role, content }) => ({ role, content })),
          shadowNotes,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { shadowNotes?: string | null };
      if (response.ok && typeof data.shadowNotes === "string" && data.shadowNotes.trim()) {
        onAcceptShadowNotes(data.shadowNotes);
      }
      if (response.ok) lastPersistedVoiceCountRef.current = voiceMessages.length;
    } catch {
      // Voice remains usable if note persistence is temporarily unavailable.
    }
  }, [onAcceptShadowNotes, shadowNotes]);

  useEffect(() => {
    const voiceMessageCount = messages.filter(isVoiceMessage).length;
    if (!voiceMessageCount || voiceMessageCount === lastPersistedVoiceCountRef.current) return;
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      persistTimerRef.current = null;
      void persistVoiceNotes();
    }, 1400);

    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [messages, persistVoiceNotes]);

  useEffect(() => () => {
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    void persistVoiceNotes();
  }, [persistVoiceNotes]);

  const active = ACTIVE_STATES.includes(live.state);
  useEffect(() => {
    onSessionActiveChange(active);
  }, [active, onSessionActiveChange]);
  useEffect(() => () => onSessionActiveChange(false), [onSessionActiveChange]);

  const latestVoiceMessage = [...messages].reverse().find(isVoiceMessage);
  const latestTranscript = live.assistantTranscript || live.userTranscript || latestVoiceMessage?.content || "";
  const transcriptSpeaker = live.assistantTranscript
    ? "Bible Nova"
    : live.userTranscript
      ? "You"
      : latestVoiceMessage?.role === "ai"
        ? "Bible Nova"
        : "You";
  const hasTranscript = showCaptions && Boolean(latestTranscript.trim());
  const presenceShouldMove = !prefersReducedMotion && active && live.state !== "ending";
  const isSpeaking = live.state === "user-speaking" || live.state === "assistant-speaking";

  const handleEnd = async () => {
    await live.stop("ended");
    await persistVoiceNotes();
  };

  const handleContinueInChat = async () => {
    await live.stop("ended");
    await persistVoiceNotes();
    onContinueInChat();
  };

  const handleExitVoice = async () => {
    await live.stop("ended");
    await persistVoiceNotes();
    onExitVoice();
  };

  const startLabel = premiumRequired
    ? "Unlock Voice"
    : cooldownActive
      ? `Available in ${cooldownMinutes} min`
    : live.state === "ended"
      ? "Begin another reflection"
      : "Start voice reflection";
  const showStartButton = !active;
  const sessionNotice = premiumRequired
    ? "Unlock private, voice-led reflections with your premium plan."
    : live.error || live.sessionNotice;
  const sessionNoticeIsError = Boolean(live.error) && !premiumRequired;

  return (
    <div className="voice-mode relative flex min-h-0 flex-1 overflow-hidden bg-transparent">
      {active && (
        <button
          type="button"
          onClick={() => void handleExitVoice()}
          aria-label="Back to Home"
          className="voice-session-close touch-target absolute right-4 top-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:right-6 sm:top-6"
        >
          <X className="h-5 w-5" aria-hidden="true" />
          <span className="sr-only">Back to Home</span>
        </button>
      )}
      <div className={cn(
        "voice-scroll-region app-scroll-region flex min-h-0 flex-1 flex-col scrollbar-hide",
        isCompactPhone ? "px-4 py-3" : "px-5 py-4 sm:px-6 sm:py-6",
      )}>
        <main className="voice-content mx-auto flex w-full max-w-[680px] flex-1 flex-col">
          <div className={cn(
            "voice-hero flex flex-1 flex-col justify-center",
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
                <span>Private during this conversation</span>
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
                        animate={prefersReducedMotion ? { height: 8 } : { height: [6, 14, 8, 6] }}
                        transition={{ duration: 0.8, delay: bar * 0.12, repeat: Infinity, ease: "easeInOut" }}
                      />
                    ))}
                  </div>
                )}
              </div>

              <h2 className="voice-state-title app-heading max-w-[20ch] font-serif text-[38px] font-semibold leading-tight tracking-[-0.02em] sm:text-[48px]">
                {STATE_HEADLINES[live.state]}
              </h2>
              <p className="voice-state-description app-muted mt-2 max-w-md text-[15px] leading-relaxed sm:text-[17px]">
                {STATE_DESCRIPTIONS[live.state]}
              </p>
            </div>
          </div>

          {hasTranscript && (
            <div
              className="voice-transcript w-full rounded-[1.25rem] border px-4 py-3.5 text-left sm:px-5"
              style={{
                background: "var(--app-surface-muted)",
                borderColor: "var(--app-card-border)",
              }}
            >
              <p className="mb-1 text-xs font-semibold" style={{ color: "var(--app-accent)" }}>
                {transcriptSpeaker}
              </p>
              <p className="app-heading line-clamp-3 text-sm leading-relaxed sm:text-[15px]">
                {latestTranscript}
              </p>
            </div>
          )}

          {sessionNotice && (
            <div
              role="status"
              className="voice-session-notice mt-3 flex w-full items-start gap-2.5 rounded-[1rem] border px-3.5 py-3 text-left text-sm leading-relaxed"
              style={{
                background: sessionNoticeIsError ? "var(--app-danger-soft)" : "var(--app-accent-soft)",
                borderColor: sessionNoticeIsError ? "color-mix(in srgb, var(--app-danger) 22%, transparent)" : "color-mix(in srgb, var(--app-accent) 22%, transparent)",
                color: sessionNoticeIsError ? "var(--app-danger)" : "var(--app-text)",
              }}
            >
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{sessionNotice}</span>
            </div>
          )}

          <div className={cn("voice-actions mt-4 w-full pb-safe", isShortPhone ? "pt-1" : "pt-2")}>
            {showStartButton ? (
              <button
                type="button"
                onClick={() => premiumRequired ? navigate("/paywall") : void live.start()}
                disabled={isTyping || cooldownActive}
                className="voice-primary-action touch-target app-primary-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-pill px-5 text-[15px] font-semibold transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {premiumRequired ? <LockKeyhole className="h-5 w-5" /> : live.state === "error" || live.state === "permission-denied" || live.state === "offline" ? <RotateCcw className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                {startLabel}
              </button>
            ) : (
              <div className="grid w-full grid-cols-3 gap-2">
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
                    aria-label="Stop assistant response"
                    className="voice-control-button touch-target app-secondary-button flex min-h-12 flex-col items-center justify-center gap-1 rounded-[1rem] px-2 text-[13px] font-medium"
                  >
                    <Pause className="h-4 w-4" />
                    <span>Stop response</span>
                  </button>
                ) : <div className="min-h-12" aria-hidden="true" />}
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
            )}

            <div className="voice-secondary-actions mt-2 flex w-full flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setShowCaptions((current) => !current)}
                className="touch-target inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 py-2 text-[13px] font-medium"
                style={{ color: showCaptions ? "var(--app-accent)" : "var(--app-text-muted)" }}
                aria-pressed={showCaptions}
              >
                <Captions className="h-4 w-4" /> Captions
              </button>
              {!active && (
                <button
                  type="button"
                  onClick={() => void handleContinueInChat()}
                  className="touch-target inline-flex min-h-10 items-center gap-1.5 rounded-pill px-3 py-2 text-[13px] font-medium"
                  style={{ color: "var(--app-text-muted)" }}
                >
                  <MessageCircle className="h-4 w-4" /> Switch to Chat
                </button>
              )}
            </div>

            {isTyping && <p className="app-muted mt-1 text-center text-xs">Finishing your previous reflection...</p>}
          </div>
        </main>
      </div>
    </div>
  );
}
