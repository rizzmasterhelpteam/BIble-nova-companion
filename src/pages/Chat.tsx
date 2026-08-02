import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Mic,
  Send,
  StopCircle,
  AlertCircle,
  Sparkles,
  ChevronRight,
  Copy,
  ArrowDown,
} from "lucide-react";
import { AppLogo } from "../components/AppLogo";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { useMobileViewport } from "../context/MobileViewportContext";
import { useVoiceSession } from "../context/VoiceSessionContext";
import { apiFetch } from "../lib/apiClient";
import { getNativePlatform, getPlatformAdapter } from "../lib/native/platform";
import { createApiStatusLoader, type ApiStatus } from "../lib/apiStatus";
import { storageGetJson, storageSet } from "../lib/webStorage";
import {
  clearVoiceReservation,
  loadVoiceReservation,
  saveVoiceReservation,
  type VoiceReservation,
} from "../lib/voiceReservation";
import {
  getChatScrollBehavior,
  shouldForceLatestAfterModeChange,
  shouldScrollChatToLatest,
} from "../lib/mobileLayout";
import {
  createSpeechRecognitionSession,
  SPEECH_UNAVAILABLE_MESSAGE,
  type RecognitionMode,
  type SpeechDiagnostics,
  type SpeechRecognitionSession,
} from "../lib/speechRecognition";
import { scheduleIdleTask } from "../lib/idleTask";
import { VoiceModeToggle } from "../components/voice/VoiceModeToggle";
import type {
  ConversationMessage,
  HomeMode,
  VoicePlaybackMetadata,
} from "../types/live";

const VoiceMode = React.lazy(() => import("../components/voice/VoiceMode"));

export type Message = ConversationMessage;

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "ai",
  content: "Peace be with you. I am Bible Nova Companion. How can I guide your spirit today?",
};

const QUICK_PROMPTS = [
  "Help me calm down after a hard day.",
  "Give me a short prayer for clarity.",
  "I feel guilty and need honest guidance.",
];

const MAX_STORED_MESSAGES = 80;
const MAX_CHAT_REQUEST_MESSAGES = 12;

const BIBLE_BOOKS =
  /\b(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+\d+:\d+\b/i;

const getMessageStorageKey = (identityKey: string | null) =>
  identityKey ? `bible-nova-companion-chat-${identityKey}` : null;

const trimStoredMessages = (messages: Message[]) => {
  if (messages.length <= MAX_STORED_MESSAGES) return messages;
  const withoutWelcome = messages.filter((message) => message.id !== WELCOME_MESSAGE.id);
  return [WELCOME_MESSAGE, ...withoutWelcome.slice(-(MAX_STORED_MESSAGES - 1))];
};

const extractReference = (message: string) => {
  const match = message.match(BIBLE_BOOKS);
  return match?.[0];
};

const loadApiStatus = createApiStatusLoader();

type ChatMessageProps = {
  isAndroidApp: boolean;
  isCompactPhone: boolean;
  message: Message;
};

const ChatMessage = React.memo(function ChatMessage({
  isAndroidApp,
  isCompactPhone,
  message,
}: ChatMessageProps) {
  const isError = message.tone === "error";
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const copyResetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) {
        window.clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard access is unavailable.");
      }
      await navigator.clipboard.writeText(message.content);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }

    if (copyResetTimerRef.current !== null) {
      window.clearTimeout(copyResetTimerRef.current);
    }
    copyResetTimerRef.current = window.setTimeout(() => setCopyStatus("idle"), 1800);
  };

  return (
    <motion.div
      initial={isAndroidApp ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: isAndroidApp ? 0 : 0.2, ease: "easeOut" }}
      className={cn(
        "chat-message-row flex w-full flex-col",
        message.role === "user" ? "items-end" : "items-start",
      )}
    >
      {message.role === "ai" && (
        <div className="flex w-full max-w-full min-w-0 items-start gap-3">
          <div
            className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border"
            style={
              isError
                ? {
                    background: "var(--app-danger-soft)",
                    borderColor: "color-mix(in srgb, var(--app-danger) 25%, transparent)",
                    color: "var(--app-danger)",
                  }
                : {
                    background: "var(--app-accent-soft)",
                    borderColor: "color-mix(in srgb, var(--app-accent) 25%, transparent)",
                    color: "var(--app-accent)",
                  }
            }
          >
            {isError ? (
              <AlertCircle className="w-[14px] h-[14px]" />
            ) : (
              <AppLogo alt="" className="h-[14px] w-[14px] rounded-full object-cover" />
            )}
          </div>

          <div className="relative flex min-w-0 flex-1 flex-col gap-2">
            <div
              className={cn(
                "break-words whitespace-pre-wrap text-[15px] leading-[1.68] font-serif font-light",
                isError ? "rounded-[1.5rem] border px-4 py-3" : "",
              )}
              style={
                isError
                  ? {
                      color: "var(--app-danger)",
                      background: "var(--app-danger-soft)",
                      borderColor: "color-mix(in srgb, var(--app-danger) 18%, transparent)",
                    }
                  : {
                      color: "var(--app-text)",
                      background: "transparent",
                      border: "0",
                      borderRadius: "0",
                      padding: "0.25rem 0",
                    }
              }
            >
              {message.content}
            </div>

            {message.reference && (
              <motion.div
                initial={isAndroidApp ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: isAndroidApp ? 0 : 0.15 }}
                className="mt-1"
              >
                <div
                  className="inline-flex rounded-pill border px-3 py-1.5"
                  style={{
                    background: "color-mix(in srgb, var(--app-card-soft) 85%, transparent)",
                    borderColor: "color-mix(in srgb, var(--app-accent) 20%, transparent)",
                  }}
                >
                  <div className="text-xs font-semibold" style={{ color: "var(--app-accent)" }}>
                    <span>
                      {message.reference}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
            {!isError && (
              <div className="mt-0.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="touch-target app-ghost-button inline-flex items-center gap-1.5 rounded-pill px-3 py-2 text-xs"
                  aria-live="polite"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : "Copy"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {message.role === "user" && (
        <div
          className={cn(
            "break-words whitespace-pre-wrap rounded-[1.2rem] rounded-tr-[0.45rem] border text-[15px] font-light leading-[1.55]",
            isCompactPhone ? "max-w-[88%] px-4 py-3" : "max-w-[82%] px-5 py-3.5",
          )}
          style={{
            background: "var(--app-accent-soft)",
            color: "var(--app-heading)",
            borderColor: "color-mix(in srgb, var(--app-card-border) 60%, transparent)",
            boxShadow: "none",
          }}
        >
          {message.content}
        </div>
      )}
    </motion.div>
  );
});

const ChatMessageList = React.memo(function ChatMessageList({
  isAndroidApp,
  isCompactPhone,
  isTyping,
  messages,
}: {
  isAndroidApp: boolean;
  isCompactPhone: boolean;
  isTyping: boolean;
  messages: Message[];
}) {
  return (
    <>
      {messages.map((message) => (
        <ChatMessage
          key={message.id}
          isAndroidApp={isAndroidApp}
          isCompactPhone={isCompactPhone}
          message={message}
        />
      ))}

      {isTyping && (
        <motion.div
          initial={isAndroidApp ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex max-w-[88%] items-center gap-3"
        >
          <div className="flex h-[30px] w-[30px] flex-shrink-0 items-center justify-center">
            <AppLogo alt="" className="h-4 w-4 rounded-full object-cover opacity-80" />
          </div>
          <div
            className="flex items-center gap-[6px] rounded-card rounded-tl-[0.5rem] px-5 py-3.5 shadow-sm"
            style={{
              background: "var(--app-card-soft)",
              border: "1px solid var(--app-card-border)",
            }}
          >
            <span className="app-typing-dot" />
            <span className="app-typing-dot" />
            <span className="app-typing-dot" />
          </div>
        </motion.div>
      )}
    </>
  );
});

type ChatProps = {
  mode?: HomeMode;
  onModeChange?: (mode: HomeMode) => void;
};

export default function Chat({ mode = "chat", onModeChange }: ChatProps) {
  useDocumentTitle("Bible Nova Companion");
  const location = useLocation();
  const navigate = useNavigate();
  const {
    identityKey,
    shadowNotes,
    memoryEnabled,
    acceptPersistedShadowNotes,
  } = useAuth();
  const { isVoiceSessionActive, setVoiceSessionActive } = useVoiceSession();
  const { isCompactPhone, isKeyboardOpen, isShortPhone, width } = useMobileViewport();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingSpeech, setIsTranscribingSpeech] = useState(false);
  const [speechMode, setSpeechMode] = useState<RecognitionMode>("unsupported");
  const [isCheckingSpeechSupport, setIsCheckingSpeechSupport] = useState(true);
  const [speechDiagnostics, setSpeechDiagnostics] = useState<SpeechDiagnostics | null>(null);
  const [speechNotice, setSpeechNotice] = useState<string | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [hasLoadedMessages, setHasLoadedMessages] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [isCheckingApiStatus, setIsCheckingApiStatus] = useState(true);
  const [voiceReservation, setVoiceReservation] = useState<VoiceReservation | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef(messages);
  const requestControllerRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const apiStatusRef = useRef<ApiStatus | null>(null);
  const handledRouteActionRef = useRef<string | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const cancelStorageWriteRef = useRef<(() => void) | null>(null);
  const lastScrolledMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const scrollToLatestAfterVoiceRef = useRef(false);
  const previousModeRef = useRef<HomeMode>(mode);
  const showQuickPrompts = messages.length === 1 && !isTyping;
  const isVoiceMode = mode === "voice";
  const isImmersiveVoice = isVoiceMode && isVoiceSessionActive;
  const chatPageRef = useRef<HTMLDivElement>(null);
  const platform = getPlatformAdapter();
  const isAndroidApp = platform.isNative && getNativePlatform() === "android";

  const refreshSpeechSupport = useCallback(async (reason = "manual") => {
    const speechSession = speechSessionRef.current;
    if (!speechSession) return null;

    setIsCheckingSpeechSupport(true);
    try {
      const diagnostics = await speechSession.getDiagnostics();
      if (speechSessionRef.current !== speechSession) return null;
      setSpeechMode(diagnostics.selectedSpeechMode);
      setSpeechDiagnostics(diagnostics);
      console.info("[Bible Nova speech diagnostics]", {
        reason,
        ...diagnostics,
        speechReady: apiStatusRef.current?.speechReady === true,
      });
      return diagnostics;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Speech support detection failed.";
      console.warn("[Bible Nova speech diagnostics] support check failed", { reason, message });
      if (speechSessionRef.current === speechSession) {
        setSpeechMode("unsupported");
        setSpeechDiagnostics(null);
      }
      return null;
    } finally {
      if (speechSessionRef.current === speechSession) setIsCheckingSpeechSupport(false);
    }
  }, []);

  useEffect(() => {
    const page = chatPageRef.current;
    const screen = page?.closest(".app-screen");
    const shell = page?.closest(".app-shell");

    screen?.classList.toggle("voice-host", isVoiceMode);
    shell?.classList.toggle("voice-host", isVoiceMode);

    return () => {
      screen?.classList.remove("voice-host");
      shell?.classList.remove("voice-host");
    };
  }, [isVoiceMode]);
  const chatUnavailable = apiStatus?.chatReady !== true;
  const speechUnavailableReason = isCheckingSpeechSupport
    ? null
    : speechMode === "unsupported"
      ? SPEECH_UNAVAILABLE_MESSAGE
      : speechMode === "web" && apiStatus?.speechReady !== true
        ? SPEECH_UNAVAILABLE_MESSAGE
        : null;
  const shouldAutoFocusInput = !platform.isNative && width >= 768;
  const shouldAutoFocusInputRef = useRef(shouldAutoFocusInput);
  const previousIdentityKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const previousIdentityKey = previousIdentityKeyRef.current;
    if (previousIdentityKey && previousIdentityKey !== identityKey) {
      clearVoiceReservation(previousIdentityKey);
    }
    previousIdentityKeyRef.current = identityKey;
    setVoiceReservation(identityKey ? loadVoiceReservation(identityKey) : null);
  }, [identityKey]);

  const updateVoiceReservation = useCallback(
    (reservation: VoiceReservation | null) => {
      if (!identityKey) return;
      if (!reservation) {
        clearVoiceReservation(identityKey);
        setVoiceReservation(null);
        return;
      }
      const next = { ...reservation, userId: identityKey };
      saveVoiceReservation(next);
      setVoiceReservation(next);
    },
    [identityKey],
  );

  useEffect(() => {
    if (!voiceReservation || !identityKey) return;
    const remaining = Date.parse(voiceReservation.expiresAt) - Date.now();
    if (remaining <= 0) {
      updateVoiceReservation(null);
      return;
    }
    const timer = window.setTimeout(() => updateVoiceReservation(null), remaining);
    return () => window.clearTimeout(timer);
  }, [identityKey, updateVoiceReservation, voiceReservation]);

  useEffect(() => {
    shouldAutoFocusInputRef.current = shouldAutoFocusInput;
  }, [shouldAutoFocusInput]);

  const resizeTextarea = useCallback(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  }, []);

  const updateInputValue = useCallback((value: string) => {
    setInput(value);
    if (resizeFrameRef.current) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      resizeTextarea();
    });
  }, [resizeTextarea]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    speechSessionRef.current = createSpeechRecognitionSession({
      onTranscript: (text) => {
        updateInputValue(text);
      },
      onListeningChange: (listening) => {
        setIsRecording(listening);
        if (!listening && shouldAutoFocusInputRef.current) {
          textareaRef.current?.focus();
        }
      },
      onProcessingChange: (isProcessing) => {
        setIsTranscribingSpeech(isProcessing);
      },
      onNotice: setSpeechNotice,
      onError: (message) => {
        setSpeechError(message);
        setIsRecording(false);
        setIsTranscribingSpeech(false);
      },
      canUseWebFallback: () => apiStatusRef.current?.speechReady === true,
    });
    void refreshSpeechSupport("initial");

    return () => {
      const speechSession = speechSessionRef.current;
      speechSessionRef.current = null;
      void speechSession?.destroy();
    };
  }, [refreshSpeechSupport, updateInputValue]);

  useEffect(() => {
    apiStatusRef.current = apiStatus;
  }, [apiStatus]);

  useEffect(() => {
    if (!platform.isNative) return;
    return platform.appState.subscribe(({ active }) => {
      if (active) void refreshSpeechSupport("app-resume");
    });
  }, [platform, refreshSpeechSupport]);

  useEffect(() => {
    const storageKey = getMessageStorageKey(identityKey);
    if (!storageKey) {
      messagesRef.current = [WELCOME_MESSAGE];
      setMessages([WELCOME_MESSAGE]);
      setHasLoadedMessages(true);
      return;
    }

    try {
      const parsed = storageGetJson<Message[]>(storageKey, [WELCOME_MESSAGE]);
      const nextMessages = trimStoredMessages(parsed.length ? parsed : [WELCOME_MESSAGE]);
      messagesRef.current = nextMessages;
      setMessages(nextMessages);
    } catch {
      messagesRef.current = [WELCOME_MESSAGE];
      setMessages([WELCOME_MESSAGE]);
    }

    setHasLoadedMessages(true);
  }, [identityKey]);

  useEffect(() => {
    const storageKey = getMessageStorageKey(identityKey);
    if (!storageKey || !hasLoadedMessages) return;
    cancelStorageWriteRef.current?.();
    cancelStorageWriteRef.current = scheduleIdleTask(() => {
      cancelStorageWriteRef.current = null;
      storageSet(storageKey, JSON.stringify(trimStoredMessages(messages)));
    }, isAndroidApp ? 1_200 : 600);

    return () => {
      cancelStorageWriteRef.current?.();
      cancelStorageWriteRef.current = null;
    };
  }, [hasLoadedMessages, identityKey, isAndroidApp, messages]);

  useEffect(() => {
    if (!hasLoadedMessages) return;
    const storageKey = getMessageStorageKey(identityKey);
    if (!storageKey) return;

    const flushMessages = () => {
      if (document.visibilityState !== "hidden") return;
      cancelStorageWriteRef.current?.();
      cancelStorageWriteRef.current = null;
      storageSet(storageKey, JSON.stringify(trimStoredMessages(messagesRef.current)));
    };

    document.addEventListener("visibilitychange", flushMessages);
    return () => {
      document.removeEventListener("visibilitychange", flushMessages);
    };
  }, [hasLoadedMessages, identityKey]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
      requestGenerationRef.current += 1;
      sendingRef.current = false;
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      cancelStorageWriteRef.current?.();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadApiStatus()
      .then((data: ApiStatus) => {
        if (isMounted) {
          apiStatusRef.current = data;
          setApiStatus(data);
          void refreshSpeechSupport("api-status-initial");
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsCheckingApiStatus(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [refreshSpeechSupport]);

  const retryApiStatus = useCallback(async () => {
    setIsCheckingApiStatus(true);
    try {
      const data = await loadApiStatus(true);
      apiStatusRef.current = data;
      setApiStatus(data);
      void refreshSpeechSupport("api-status-retry");
      return data.voiceReady === true;
    } finally {
      setIsCheckingApiStatus(false);
    }
  }, [refreshSpeechSupport]);

  const appendUserMessage = useCallback((content: string, source: "voice" | "chat" = "chat") => {
    const trimmedContent = content.trim();
    if (!trimmedContent) return;

    const nextMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedContent,
      source,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => {
      const nextMessages = trimStoredMessages([...prev, nextMessage]);
      messagesRef.current = nextMessages;
      return nextMessages;
    });
  }, []);

  const appendAiMessage = useCallback((
    content: string,
    tone: "default" | "error" = "default",
    source: "voice" | "chat" = "chat",
    playback?: VoicePlaybackMetadata,
  ) => {
    const id = crypto.randomUUID();
    const nextMessage: Message = {
      id,
      role: "ai",
      content,
      reference: tone === "default" ? extractReference(content) : undefined,
      tone,
      source,
      createdAt: new Date().toISOString(),
      ...playback,
    };

    setMessages((prev) => {
      const nextMessages = trimStoredMessages([...prev, nextMessage]);
      messagesRef.current = nextMessages;
      return nextMessages;
    });
    return id;
  }, []);

  const appendVoiceUserMessage = useCallback((content: string) => {
    appendUserMessage(content, "voice");
  }, [appendUserMessage]);

  const appendVoiceAssistantMessage = useCallback((
    content: string,
    playback: VoicePlaybackMetadata,
  ) => {
    return appendAiMessage(content, "default", "voice", playback);
  }, [appendAiMessage]);

  const updateVoiceAssistantPlayback = useCallback((
    messageId: string,
    playback: VoicePlaybackMetadata,
  ) => {
    setMessages((previous) => {
      const nextMessages = previous.map((message) =>
        message.id === messageId
          ? { ...message, ...playback }
          : message,
      );
      messagesRef.current = nextMessages;
      return nextMessages;
    });
  }, []);

  const continueInChat = useCallback(() => {
    scrollToLatestAfterVoiceRef.current = true;
    setVoiceSessionActive(false);
    onModeChange?.("chat");
  }, [onModeChange, setVoiceSessionActive]);

  const handleModeChange = useCallback((nextMode: HomeMode) => {
    if (nextMode === "voice" && isTyping) {
      requestControllerRef.current?.abort();
      requestGenerationRef.current += 1;
      sendingRef.current = false;
      setIsTyping(false);
    }
    if (nextMode === "chat" && isVoiceMode) {
      scrollToLatestAfterVoiceRef.current = true;
    }
    onModeChange?.(nextMode);
  }, [isTyping, isVoiceMode, onModeChange]);

  const handleSend = useCallback(async (text: string) => {
    if (sendingRef.current || apiStatus?.chatReady !== true) return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    setSpeechError(null);

    if (isRecording) {
      await speechSessionRef.current?.stop();
    }

    requestControllerRef.current?.abort();
    const requestGeneration = ++requestGenerationRef.current;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    sendingRef.current = true;

    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmedText,
      source: "chat",
      createdAt: new Date().toISOString(),
    };

    const nextMessages = trimStoredMessages([...messagesRef.current, userMessage]);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");
    setIsTyping(true);
    setIsRecording(false);

    try {
      const response = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.slice(-MAX_CHAT_REQUEST_MESSAGES).map((message) => ({
            role: message.role,
            content: message.content,
          })),
          shadowNotes,
        }),
        signal: controller.signal,
      });

      if (requestGeneration !== requestGenerationRef.current) return;

      const responseText = await response.text();
      let data: { message?: string; shadowNotes?: string | null; error?: string };

      try {
        data = JSON.parse(responseText);
      } catch {
        const preview = responseText
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 160);
        throw new Error(
          preview
            ? `Server returned an unreadable response (${response.status}): ${preview}`
            : `Server returned an unreadable response (${response.status}).`,
        );
      }

      if (!response.ok) {
        throw new Error(data.error || `Unable to generate a response (${response.status}).`);
      }

      if (typeof data.shadowNotes === "string" && data.shadowNotes.trim() && data.shadowNotes !== shadowNotes) {
        acceptPersistedShadowNotes(data.shadowNotes);
      }

      appendAiMessage(data.message || "I could not form a response just now.");
    } catch (error) {
      if (requestGeneration !== requestGenerationRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error(error);
      const message =
        error instanceof Error
          ? error.message
          : "I am sorry, I hit an unexpected problem while reflecting on that.";
      appendAiMessage(message, "error");
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        sendingRef.current = false;
        setIsTyping(false);
        if (requestControllerRef.current === controller) requestControllerRef.current = null;
        if (shouldAutoFocusInputRef.current) {
          textareaRef.current?.focus();
        }
      }
    }
  }, [acceptPersistedShadowNotes, apiStatus?.chatReady, appendAiMessage, isRecording, isTyping, shadowNotes]);

  useEffect(() => {
    if (!hasLoadedMessages) {
      return;
    }

    const routeState = location.state as { initialPrompt?: string; startVoice?: boolean } | null;
    const actionKey = routeState?.initialPrompt
      ? `prompt:${routeState.initialPrompt}`
      : routeState?.startVoice
        ? "voice"
        : null;

    if (!actionKey) {
      handledRouteActionRef.current = null;
      return;
    }

    if (routeState?.initialPrompt && apiStatus?.chatReady !== true) {
      return;
    }

    if (handledRouteActionRef.current === actionKey) {
      return;
    }

    handledRouteActionRef.current = actionKey;

    if (routeState.initialPrompt) {
      void handleSend(routeState.initialPrompt);
      navigate(location.pathname, { replace: true, state: {} });
      return;
    }

    handleModeChange("voice");
    navigate(location.pathname, { replace: true, state: {} });
  }, [apiStatus?.chatReady, handleModeChange, handleSend, hasLoadedMessages, location.pathname, location.state, navigate]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      const messageCountChanged = lastScrolledMessageCountRef.current !== messages.length;
      const behavior = getChatScrollBehavior(isKeyboardOpen, messageCountChanged);
      lastScrolledMessageCountRef.current = messages.length;
      if (showQuickPrompts && !isKeyboardOpen) {
        container.scrollTo({ top: 0, behavior });
        return;
      }

      if (shouldScrollChatToLatest(isNearBottomRef.current, false)) {
        container.scrollTo({ top: container.scrollHeight, behavior });
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isKeyboardOpen, messages.length, isTyping, showQuickPrompts]);

  useLayoutEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = mode;
    if (shouldForceLatestAfterModeChange(previousMode, mode)) {
      scrollToLatestAfterVoiceRef.current = true;
    }
    if (isVoiceMode || !scrollToLatestAfterVoiceRef.current) return;

    let secondFrame: number | null = null;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = scrollContainerRef.current;
        if (!container) return;
        scrollToLatestAfterVoiceRef.current = false;
        isNearBottomRef.current = true;
        setShowJumpToLatest(false);
        container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
    };
  }, [isVoiceMode, messages.length, mode]);

  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 96;
    isNearBottomRef.current = isNearBottom;
    if (isNearBottom) setShowJumpToLatest(false);
  }, []);

  const jumpToLatest = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    isNearBottomRef.current = true;
    setShowJumpToLatest(false);
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (!shouldAutoFocusInput) return;
    textareaRef.current?.focus();
  }, [shouldAutoFocusInput]);

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setSpeechError(null);
    updateInputValue(event.target.value);
  };

  const startSpeechRecognition = async () => {
    if (isTyping || isTranscribingSpeech) return;

    setSpeechError(null);
    setSpeechNotice(null);

    let resolvedSpeechMode = speechMode;
    if (isAndroidApp) {
      const diagnostics = await refreshSpeechSupport("mic-tap");
      resolvedSpeechMode = diagnostics?.selectedSpeechMode ?? speechMode;
    }

    if (resolvedSpeechMode === "unsupported") {
      setSpeechError(SPEECH_UNAVAILABLE_MESSAGE);
      return;
    }

    if (resolvedSpeechMode === "web" && apiStatusRef.current?.speechReady !== true) {
      setSpeechError(SPEECH_UNAVAILABLE_MESSAGE);
      return;
    }

    const speechSession = speechSessionRef.current;
    if (!speechSession) {
      setSpeechError(SPEECH_UNAVAILABLE_MESSAGE);
      setIsRecording(false);
      setIsTranscribingSpeech(false);
      return;
    }

    let refreshReason = "permission-request-complete";
    try {
      await speechSession.start(input);
    } catch (error) {
      refreshReason = "native-start-failure";
      setSpeechError(
        error instanceof Error ? error.message : "Speech recognition could not start.",
      );
      setIsRecording(false);
      setIsTranscribingSpeech(false);
      await speechSession.stop().catch(() => undefined);
    } finally {
      await refreshSpeechSupport(refreshReason);
    }
  };

  const stopSpeechRecognition = async () => {
    setSpeechError(null);

    try {
      await speechSessionRef.current?.stop();
    } catch (error) {
      setSpeechError(
        error instanceof Error ? error.message : "Speech recognition could not stop cleanly.",
      );
      setIsRecording(false);
      setIsTranscribingSpeech(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      await stopSpeechRecognition();
      return;
    }

    await startSpeechRecognition();
  };

  return (
    <div ref={chatPageRef} className={cn(
      "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent",
      isVoiceMode && "voice-page",
      isImmersiveVoice && "voice-session-active",
    )}>
      {!isImmersiveVoice && <header
        className={cn(
          "z-20 flex shrink-0 items-center justify-between border-b pr-14 transition-colors duration-200",
          !isVoiceMode && "backdrop-blur-xl",
          isCompactPhone ? "min-h-[56px] px-3.5 py-1.5" : "min-h-[64px] px-4 py-2 sm:px-6",
        )}
        style={{
          backgroundColor: isVoiceMode ? "transparent" : "var(--app-surface-solid)",
          backgroundImage: isVoiceMode ? "none" : "var(--app-shell-highlight)",
          borderColor: isVoiceMode ? "transparent" : "color-mix(in srgb, var(--app-divider) 50%, transparent)",
          boxShadow: isVoiceMode ? "none" : "0 4px 24px rgba(0,0,0,0.08), inset 0 -1px 0 color-mix(in srgb, var(--app-divider) 40%, transparent)",
        }}
      >
        <div className={cn("flex items-center", isCompactPhone ? "gap-3" : "gap-4")}>
          <div className="relative">
            <div className={cn(
              "app-logo-badge flex items-center justify-center overflow-hidden rounded-full ring-2",
              isCompactPhone ? "h-[38px] w-[38px]" : "h-[44px] w-[44px]"
            )}
              style={{ ringColor: "color-mix(in srgb, var(--app-accent) 20%, transparent)" }}
            >
              <AppLogo alt="" className="h-full w-full object-cover" />
            </div>
            {/* Pulsing online dot */}
            <div
              className="app-status-dot absolute bottom-0 right-0 h-3 w-3 rounded-full border-2"
              style={{ background: "var(--app-success)", borderColor: "var(--app-shell-bg)" }}
            />
          </div>
          <div className="min-w-0">
            <h3 className={cn("app-heading font-serif font-semibold tracking-tight", isCompactPhone ? "text-[18px]" : "text-[21px] sm:text-[23px]")}>
              Bible Nova Companion
            </h3>
            <p className="app-kicker mt-1 truncate text-[10px] sm:text-[11px]">
              {isCompactPhone ? "Private space" : "Private reflection space"}
            </p>
          </div>
        </div>
      </header>}

      {!isImmersiveVoice && onModeChange && (
        <div className={cn("shrink-0 px-3 pt-0.5 sm:px-6 sm:pt-1", isVoiceMode && "voice-mode-row")}>
          <div className="mx-auto flex w-full max-w-[680px] justify-center sm:justify-start">
            <VoiceModeToggle
              value={mode}
              onChange={handleModeChange}
              className="w-auto max-w-full justify-center"
            />
          </div>
        </div>
      )}

      {isVoiceMode ? (
        <React.Suspense fallback={<div className="min-h-0 flex-1" aria-busy="true" />}>
          <VoiceMode
            userId={identityKey || ""}
            messages={messages}
            shadowNotes={shadowNotes}
            memoryEnabled={memoryEnabled}
            isTyping={isTyping}
            onAppendUserMessage={appendVoiceUserMessage}
            onAppendAssistantMessage={appendVoiceAssistantMessage}
            onUpdateAssistantVoicePlayback={updateVoiceAssistantPlayback}
            onAcceptShadowNotes={acceptPersistedShadowNotes}
            onExitVoice={continueInChat}
            onSessionActiveChange={setVoiceSessionActive}
            reservation={voiceReservation}
            onReservationChange={updateVoiceReservation}
            voiceReady={apiStatus?.voiceReady === true}
            isCheckingVoiceReady={isCheckingApiStatus}
            apiStatusConnectionError={apiStatus?.connectionError}
            onRetryVoiceReady={retryApiStatus}
          />
        </React.Suspense>
      ) : (
      <>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          "app-scroll-region z-10 flex flex-1 flex-col scrollbar-hide",
          isCompactPhone ? "px-3 py-3" : "px-4 py-4 sm:px-6",
        )}
      >
        <div className={cn("mx-auto flex w-full max-w-3xl flex-col", isCompactPhone ? "gap-3" : "gap-4")}>
        {showQuickPrompts && !chatUnavailable && (
          <motion.div
            initial={isAndroidApp ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: isAndroidApp ? 0 : 0.25, ease: "easeOut" }}
            className={cn(
              "app-panel app-card-shimmer relative overflow-hidden shadow-xl",
              isShortPhone ? "rounded-[1.75rem] p-4" : isCompactPhone ? "rounded-[2rem] p-5" : "rounded-[2.5rem] p-6",
            )}
            style={{
              backgroundColor: "var(--app-surface-solid)",
              backgroundImage: "var(--app-shell-highlight)",
              borderColor: "color-mix(in srgb, var(--app-card-border) 60%, transparent)",
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-[color:color-mix(in_srgb,var(--app-accent)_5%,transparent)] to-transparent pointer-events-none" />
            <div className="relative z-10">
              <div className="app-accent mb-3 flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)" }}>
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-[0.2em]">
                  Start gently
                </p>
              </div>
              <p className={cn("app-muted max-w-[96%] text-[14px] leading-relaxed", isShortPhone ? "mb-3" : "mb-5")}>
                Pick a prompt to start, or write your own reflection below.
              </p>
              <div className="flex flex-col gap-2">
                {QUICK_PROMPTS.map((prompt, i) => (
                  <motion.button
                    key={prompt}
                    initial={isAndroidApp ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: isAndroidApp ? 0 : 0.05 * i, duration: isAndroidApp ? 0 : 0.2 }}
                    onClick={() => handleSend(prompt)}
                    className={cn(
                      "app-secondary-button flex items-center justify-between rounded-[1.25rem] px-4 text-left text-[14px] font-medium leading-[1.4] shadow-sm active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:color-mix(in_srgb,var(--app-accent)_50%,transparent)]",
                      isShortPhone ? "py-2.5" : "py-3.5",
                    )}
                  >
                    <span className="flex-1">{prompt}</span>
                    <ChevronRight className="ml-3 h-4 w-4 flex-shrink-0 opacity-40" />
                  </motion.button>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {chatUnavailable && !isCheckingApiStatus && (
          <motion.div
            initial={isAndroidApp ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            className="rounded-[2rem] p-5 shadow-lg"
            style={{
              background: "var(--app-accent-soft)",
              border: "1px solid color-mix(in srgb, var(--app-accent) 26%, transparent)",
            }}
          >
            <div className="app-accent mb-3 flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Connection unavailable
              </p>
            </div>
            <p className="app-heading text-sm leading-relaxed">
              {apiStatus?.connectionError || "Chat is temporarily unavailable. Please try again in a moment."}
            </p>
            <button
              type="button"
              onClick={() => void retryApiStatus()}
              className="touch-target app-secondary-button mt-4 inline-flex items-center justify-center rounded-pill px-4 py-2 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              Check connection
            </button>
          </motion.div>
        )}

        <ChatMessageList
          isAndroidApp={isAndroidApp}
          isCompactPhone={isCompactPhone}
          isTyping={isTyping}
          messages={messages}
        />
        </div>
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="touch-target app-secondary-button absolute bottom-24 right-4 z-30 inline-flex items-center gap-2 rounded-pill px-3 py-2 text-xs font-semibold shadow-lg"
          aria-label="Jump to latest message"
        >
          <ArrowDown className="h-4 w-4" /> Latest
        </button>
      )}

      <div
        className={cn(
          "shrink-0 transition-colors duration-300",
          isCompactPhone ? "px-3 pt-1" : "px-4 pt-1 sm:px-6",
          isKeyboardOpen ? "pb-1" : "pb-safe-tight",
        )}
        style={{
          background: "transparent",
        }}
      >
        <div className="mx-auto w-full max-w-3xl">
          <div className="min-h-0" aria-live="polite">{(isRecording ||
            isTranscribingSpeech ||
            speechError ||
            speechNotice ||
            speechUnavailableReason) && (
            <p
              className="mb-1 px-1 text-center text-[11px]"
              style={{
                color: speechError ? "var(--app-danger)" : "var(--app-text-muted)",
              }}
            >
              {speechError || speechNotice
                ? speechError || speechNotice
                : speechUnavailableReason
                ? speechUnavailableReason
                : isRecording
                ? "Listening. Tap stop when you're done."
                : isTranscribingSpeech
                ? "Transcribing your speech..."
                : ""}
            </p>
          )}</div>

          <div
            className={cn(
              "flex w-full items-end gap-1.5 rounded-pill border p-1 transition-all duration-300 focus-within:ring-1 focus-within:ring-[color:color-mix(in_srgb,var(--app-accent)_25%,transparent)] focus-within:border-[color:color-mix(in_srgb,var(--app-accent)_50%,transparent)]",
              isCompactPhone ? "pl-3" : "pl-3.5",
            )}
            style={{
              backgroundColor: "var(--app-input-bg)",
              backgroundImage: "none",
              borderColor: "color-mix(in srgb, var(--app-input-border) 72%, transparent)",
              boxShadow: "0 6px 18px rgba(0,0,0,0.08)",
            }}
          >
            <textarea
              id="chat-message"
              name="message"
              ref={textareaRef}
              value={input}
              onChange={handleInput}
              disabled={isTyping || chatUnavailable}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!isTyping) handleSend(input);
                }
              }}
              placeholder={
                isCheckingApiStatus
                  ? "Checking chat connection..."
                  : chatUnavailable
                    ? "Chat is unavailable while we reconnect..."
                    : "Share your thoughts..."
              }
              enterKeyHint="send"
              aria-label="Message Bible Nova Companion"
              className={cn(
                "scrollbar-hide w-full resize-none bg-transparent py-2.5 font-sans font-light leading-[1.5] outline-none",
                isShortPhone ? "min-h-[42px] max-h-24 text-[14px]" : "min-h-[42px] max-h-28 text-[15px]",
              )}
              style={{ color: "var(--app-heading)" }}
              rows={1}
            />

            <div className="flex h-[42px] flex-shrink-0 items-center justify-center pr-0.5">
              {isRecording ? (
                <button
                  onClick={() => {
                    void toggleRecording();
                  }}
                  disabled={isTyping}
                  className={cn("touch-target relative flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300 active:scale-[0.97] shadow-sm", isTyping && "cursor-not-allowed opacity-50")}
                  style={{
                    background: "var(--app-danger-soft)",
                    color: "var(--app-danger)",
                    borderColor: "color-mix(in srgb, var(--app-danger) 40%, transparent)",
                  }}
                >
                  <StopCircle className="w-4 h-4" />
                </button>
              ) : isTranscribingSpeech ? (
                <div
                  className="touch-target flex h-[38px] w-[38px] items-center justify-center rounded-full border shadow-sm"
                  style={{
                    background: "var(--app-secondary-bg)",
                    borderColor: "var(--app-secondary-border)",
                    color: "var(--app-text-muted)",
                  }}
                >
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current" />
                </div>
              ) : input.trim() ? (
                <button
                  onClick={() => handleSend(input)}
                  disabled={isTyping || chatUnavailable || isTranscribingSpeech}
                  className={cn(
                    "touch-target app-primary-button flex h-9 w-9 items-center justify-center rounded-full transition-all active:scale-95",
                    isTyping && "cursor-not-allowed opacity-50 grayscale",
                  )}
                  style={{
                    boxShadow: "0 4px 16px color-mix(in srgb, var(--app-accent) 40%, transparent), 0 8px 24px rgba(0,0,0,0.12)",
                  }}
                >
                  <Send strokeWidth={2.5} className="w-[18px] h-[18px] ml-0.5" />
                </button>
              ) : (
                <button
                  onClick={() => {
                    void toggleRecording();
                  }}
                  disabled={isTyping || isTranscribingSpeech}
                  className={cn("touch-target relative flex h-9 w-9 items-center justify-center rounded-full border transition-all duration-300 active:scale-[0.97] shadow-sm", (isTyping || isTranscribingSpeech) && "cursor-not-allowed opacity-50")}
                  aria-label={
                    speechUnavailableReason ? "Retry speech-to-text support" : "Start speech-to-text"
                  }
                  style={
                    {
                      background: "var(--app-secondary-bg)",
                      color: "var(--app-text-muted)",
                      borderColor: "var(--app-secondary-border)",
                    }
                  }
                >
                  <Mic strokeWidth={2} className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
