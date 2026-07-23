import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  CircleStop,
  Mic,
  MicOff,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useNavigate } from "react-router-dom";
import { AppLogo } from "../AppLogo";
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
};

const STATE_COPY: Record<VoiceState, string> = {
  idle: "Take a quiet moment. Speak when you're ready.",
  "requesting-permission": "Your microphone is only used while you are speaking with Bible Nova.",
  connecting: "Preparing your private reflection space...",
  ready: "Your reflection space is ready.",
  listening: "I'm listening.",
  "user-speaking": "Take your time.",
  thinking: "Reflecting on what you shared...",
  "assistant-speaking": "Bible Nova is responding.",
  interrupted: "I'm listening.",
  reconnecting: "Restoring your conversation...",
  ending: "Keeping your reflection safe...",
  ended: "Your reflection is complete.",
  "permission-denied": "Microphone access is needed for Voice mode.",
  offline: "Reconnect to the internet to start Voice mode.",
  error: "Voice is temporarily unavailable.",
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
}: VoiceModeProps) {
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const navigate = useNavigate();
  const prefersReducedMotion = useReducedMotion();
  const [showCaptions, setShowCaptions] = useState(true);
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
  });
  const premiumRequired = live.error?.toLowerCase().includes("premium subscription") ?? false;

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
  const latestVoiceMessage = [...messages].reverse().find(isVoiceMessage);
  const latestTranscript = live.assistantTranscript || live.userTranscript || latestVoiceMessage?.content || "";
  const orbShouldMove = !prefersReducedMotion && active && live.state !== "ending";

  const handleEnd = async () => {
    await live.stop("ended");
    await persistVoiceNotes();
  };

  const handleContinueInChat = async () => {
    await live.stop("ended");
    await persistVoiceNotes();
    onContinueInChat();
  };

  const startLabel = premiumRequired
    ? "Unlock Voice"
    : live.state === "ended"
      ? "Start a new reflection"
      : "Start conversation";
  const showStartButton = !active;
  const showErrorAction = Boolean(live.error) || live.state === "permission-denied" || live.state === "offline";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <div className={cn(
        "app-scroll-region flex min-h-0 flex-1 flex-col scrollbar-hide",
        isCompactPhone ? "px-4 py-4" : "px-5 py-5 sm:px-6",
      )}>
        <div className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4">
          <section
            className={cn(
              "app-panel relative flex w-full flex-1 flex-col items-center justify-center overflow-hidden text-center",
              isShortPhone ? "rounded-[2rem] p-5" : "rounded-[2.5rem] p-6 sm:p-8",
            )}
            style={{
              minHeight: isShortPhone ? "300px" : "360px",
              background: "var(--app-surface-solid)",
              backgroundImage: "var(--app-shell-highlight)",
              borderColor: "var(--app-card-border)",
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 opacity-60"
              style={{ background: "radial-gradient(circle at 50% 38%, color-mix(in srgb, var(--app-accent) 12%, transparent), transparent 48%)" }}
            />

            <div className="relative z-10 flex max-w-sm flex-col items-center">
              <div className="relative mb-6 flex h-32 w-32 items-center justify-center sm:h-36 sm:w-36">
                {orbShouldMove && (
                  <motion.div
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full"
                    animate={{ scale: [0.88, 1.08, 0.88], opacity: [0.24, 0.5, 0.24] }}
                    transition={{ duration: live.state === "assistant-speaking" ? 1.1 : 3.2, repeat: Infinity, ease: "easeInOut" }}
                    style={{ background: "var(--app-accent-soft)", boxShadow: "0 0 60px color-mix(in srgb, var(--app-accent) 24%, transparent)" }}
                  />
                )}
                <div
                  className="relative flex h-24 w-24 items-center justify-center rounded-full border shadow-xl sm:h-28 sm:w-28"
                  style={{
                    background: "var(--app-accent-gradient)",
                    borderColor: "color-mix(in srgb, var(--app-accent) 36%, transparent)",
                    boxShadow: "var(--app-accent-shadow), inset 0 1px 0 rgba(255,255,255,0.24)",
                  }}
                >
                  <AppLogo alt="" className="h-14 w-14 rounded-full object-cover sm:h-16 sm:w-16" />
                </div>
              </div>

              <p className="app-kicker mb-2 text-[10px]">PRIVATE VOICE REFLECTION</p>
              <h2 className="app-heading text-xl font-semibold tracking-tight sm:text-2xl">
                {live.state === "assistant-speaking" ? "A quiet answer" : "Speak freely"}
              </h2>
              <p className="app-muted mt-2 max-w-xs text-sm leading-relaxed" aria-live="polite">
                {STATE_COPY[live.state]}
              </p>

              <AnimatePresence mode="wait" initial={false}>
                {showCaptions && latestTranscript && (
                  <motion.p
                    key={latestTranscript}
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    className="app-heading mt-5 max-w-sm text-sm leading-relaxed"
                  >
                    &quot;{latestTranscript}&quot;
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </section>

          {(live.error || live.sessionNotice) && (
            <div
              role="status"
              className="w-full rounded-[1.5rem] border px-4 py-3 text-center text-sm leading-relaxed"
              style={{
                background: live.error ? "var(--app-danger-soft)" : "var(--app-accent-soft)",
                borderColor: live.error ? "color-mix(in srgb, var(--app-danger) 22%, transparent)" : "color-mix(in srgb, var(--app-accent) 22%, transparent)",
                color: live.error ? "var(--app-danger)" : "var(--app-text)",
              }}
            >
              {live.error || live.sessionNotice}
            </div>
          )}
        </div>
      </div>

      <div
        className={cn(
          "shrink-0 border-t border-[color:color-mix(in_srgb,var(--app-divider)_50%,transparent)] px-4 pb-safe pt-3 sm:px-6",
          isShortPhone ? "pt-2" : "pt-3",
        )}
        style={{ background: "var(--bg-base)" }}
      >
        <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-3">
          {showStartButton ? (
            <button
              type="button"
              onClick={() => premiumRequired ? navigate("/paywall") : void live.start()}
              disabled={isTyping}
              className="touch-target app-primary-button inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-pill px-6 text-base font-semibold text-white shadow-lg transition-transform active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {live.state === "error" || live.state === "permission-denied" || live.state === "offline" ? <RotateCcw className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
              {startLabel}
            </button>
          ) : (
            <div className="flex w-full items-center justify-center gap-2">
              <button
                type="button"
                onClick={live.toggleMute}
                aria-label={live.isMuted ? "Unmute microphone" : "Mute microphone"}
                className="touch-target app-secondary-button flex h-12 w-12 items-center justify-center rounded-full"
              >
                {live.isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
              <button
                type="button"
                onClick={live.interrupt}
                disabled={live.state !== "assistant-speaking"}
                aria-label="Stop assistant audio"
                className="touch-target app-secondary-button flex h-12 min-w-28 items-center justify-center gap-2 rounded-pill px-4 text-sm font-semibold disabled:opacity-40"
              >
                <Pause className="h-4 w-4" /> Stop audio
              </button>
              <button
                type="button"
                onClick={() => void handleEnd()}
                aria-label="End voice conversation"
                className="touch-target flex h-12 w-12 items-center justify-center rounded-full border"
                style={{ color: "var(--app-danger)", borderColor: "color-mix(in srgb, var(--app-danger) 30%, transparent)", background: "var(--app-danger-soft)" }}
              >
                <CircleStop className="h-5 w-5" />
              </button>
            </div>
          )}

          <div className="flex w-full items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowCaptions((current) => !current)}
              className="touch-target inline-flex items-center gap-1.5 rounded-pill px-2 py-2 text-xs font-medium"
              style={{ color: showCaptions ? "var(--app-accent)" : "var(--app-text-muted)" }}
              aria-pressed={showCaptions}
            >
              <Captions className="h-4 w-4" /> Captions
            </button>
            <button
              type="button"
              onClick={() => void handleContinueInChat()}
              className="touch-target inline-flex items-center gap-1.5 rounded-pill px-2 py-2 text-xs font-medium"
              style={{ color: "var(--app-text-muted)" }}
            >
              <Volume2 className="h-4 w-4" /> Switch to Chat
            </button>
          </div>

          {showErrorAction && (
            <p className="app-muted text-center text-[11px]">
              Chat stays available even when Voice mode cannot connect.
            </p>
          )}
          {isTyping && <p className="app-muted text-center text-[11px]">Finishing your previous reflection...</p>}
        </div>
      </div>
    </div>
  );
}
