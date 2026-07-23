import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Mic,
  Send,
  StopCircle,
  AlertCircle,
  Sparkles,
  KeyRound,
  Volume2,
  Square,
  ChevronRight,
  Copy,
  ArrowDown,
} from "lucide-react";
import { AppLogo } from "../components/AppLogo";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../context/AuthContext";
import { useMobileViewport } from "../context/MobileViewportContext";
import { apiFetch } from "../lib/apiClient";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { storageGetJson, storageSet } from "../lib/webStorage";
import {
  clearVoiceReservation,
  loadVoiceReservation,
  saveVoiceReservation,
  type VoiceReservation,
} from "../lib/voiceReservation";
import { getChatScrollBehavior } from "../lib/mobileLayout";
import {
  createSpeechRecognitionSession,
  type SpeechRecognitionSession,
} from "../lib/speechRecognition";
import {
  createTextToSpeechSession,
  type TextToSpeechSession,
} from "../lib/textToSpeech";
import { VoiceModeToggle } from "../components/voice/VoiceModeToggle";
import VoiceMode from "../components/voice/VoiceMode";
import type { ConversationMessage, HomeMode } from "../types/live";

export type Message = ConversationMessage;

type ApiStatus = {
  chatReady: boolean;
  prayerReady: boolean;
  speechReady?: boolean;
};

const DEFAULT_API_STATUS: ApiStatus = {
  chatReady: true,
  prayerReady: true,
};

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

let apiStatusPromise: Promise<ApiStatus> | null = null;

const loadApiStatus = () => {
  if (!apiStatusPromise) {
    apiStatusPromise = apiFetch("/api/status")
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Status request failed with ${response.status}.`);
        }

        return response.json() as Promise<ApiStatus>;
      })
      .catch(() => DEFAULT_API_STATUS);
  }

  return apiStatusPromise;
};

type ChatMessageProps = {
  isAndroidApp: boolean;
  isCompactPhone: boolean;
  message: Message;
  onSpeak: (message: Message) => void;
  speakingMessageId: string | null;
  voiceSupported: boolean;
};

const ChatMessage = React.memo(function ChatMessage({
  isAndroidApp,
  isCompactPhone,
  message,
  onSpeak,
  speakingMessageId,
  voiceSupported,
}: ChatMessageProps) {
  const isError = message.tone === "error";

  return (
    <motion.div
      initial={isAndroidApp ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: isAndroidApp ? 0 : 0.2, ease: "easeOut" }}
      className={cn(
        "flex flex-col w-full",
        message.role === "user" ? "items-end" : "items-start",
      )}
    >
      {message.role === "ai" && (
        <div className="flex w-full max-w-full min-w-0 items-start gap-3">
          <div
            className="w-[30px] h-[30px] mt-0.5 flex-shrink-0 rounded-full border flex items-center justify-center"
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
                "break-words whitespace-pre-wrap text-[16px] leading-[1.8] font-serif font-light",
                isError ? "rounded-[1.5rem] border px-4 py-3" : "",
              )}
              style={
                isError
                  ? {
                      color: "var(--app-danger)",
                      background: "var(--app-danger-soft)",
                      borderColor: "color-mix(in srgb, var(--app-danger) 18%, transparent)",
                    }
                  : { color: "var(--app-text)" }
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
            {!isError && <div className="flex items-center gap-1"><button type="button" onClick={() => void navigator.clipboard?.writeText(message.content)} className="touch-target app-ghost-button inline-flex items-center gap-1.5 rounded-pill px-3 py-2 text-xs"><Copy className="h-3.5 w-3.5" />Copy</button>{voiceSupported && <button type="button" onClick={() => onSpeak(message)} className="touch-target app-ghost-button inline-flex items-center gap-1.5 rounded-pill px-3 py-2 text-xs">{speakingMessageId === message.id ? <Square className="h-3.5 w-3.5 fill-current" /> : <Volume2 className="h-3.5 w-3.5" />}{speakingMessageId === message.id ? "Stop" : "Listen"}</button>}</div>}
          </div>
        </div>
      )}

      {message.role === "user" && (
        <div
          className={cn(
            "break-words whitespace-pre-wrap rounded-[1.5rem] rounded-tr-[0.5rem] border text-[15px] font-light leading-relaxed",
            isCompactPhone ? "max-w-[90%] px-5 py-3.5" : "max-w-[85%] px-6 py-4",
          )}
          style={{
            background: "color-mix(in srgb, var(--app-card-strong) 92%, transparent)",
            color: "var(--app-heading)",
            borderColor: "color-mix(in srgb, var(--app-card-border) 60%, transparent)",
            boxShadow: [
              "inset 0 1px 0 0 color-mix(in srgb, white 14%, transparent)",
              "inset 0 0 0 0.5px color-mix(in srgb, white 6%, transparent)",
              "0 8px 24px rgba(0,0,0,0.08)",
            ].join(", "),
          }}
        >
          {message.content}
        </div>
      )}
    </motion.div>
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
    acceptPersistedShadowNotes,
  } = useAuth();
  const { isCompactPhone, isKeyboardOpen, isShortPhone, width } = useMobileViewport();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribingSpeech, setIsTranscribingSpeech] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);
  const [hasLoadedMessages, setHasLoadedMessages] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceReservation, setVoiceReservation] = useState<VoiceReservation | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef(messages);
  const requestControllerRef = useRef<AbortController | null>(null);
  const speechSessionRef = useRef<SpeechRecognitionSession | null>(null);
  const ttsSessionRef = useRef<TextToSpeechSession | null>(null);
  const handledRouteActionRef = useRef<string | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const storageWriteTimerRef = useRef<number | null>(null);
  const lastScrolledMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);
  const showQuickPrompts = messages.length === 1 && !isTyping;
  const isVoiceMode = mode === "voice";
  const chatUnavailable = apiStatus?.chatReady === false;
  const isAndroidApp = isNativePlatform() && getNativePlatform() === "android";
  const shouldAutoFocusInput = !isNativePlatform() && width >= 768;
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
    (reservation: { handle: string; expiresAt: string } | null) => {
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
      onError: (message) => {
        setSpeechError(message);
        setIsRecording(false);
        setIsTranscribingSpeech(false);
      },
    });

    const ttsSession = createTextToSpeechSession({
      onSpeakingChange: (messageId) => {
        setSpeakingMessageId(messageId);
      },
      onError: (message) => {
        setTtsError(message);
      },
    });

    ttsSessionRef.current = ttsSession;
    setVoiceSupported(ttsSession.isSupported());

    return () => {
      const speechSession = speechSessionRef.current;
      speechSessionRef.current = null;
      ttsSessionRef.current = null;
      void speechSession?.destroy();
      ttsSession.destroy();
    };
  }, [updateInputValue]);

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
    if (storageWriteTimerRef.current !== null) {
      window.clearTimeout(storageWriteTimerRef.current);
    }

    storageWriteTimerRef.current = window.setTimeout(() => {
      storageWriteTimerRef.current = null;
      storageSet(storageKey, JSON.stringify(trimStoredMessages(messages)));
    }, isAndroidApp ? 450 : 180);

    return () => {
      if (storageWriteTimerRef.current !== null) {
        window.clearTimeout(storageWriteTimerRef.current);
        storageWriteTimerRef.current = null;
      }
    };
  }, [hasLoadedMessages, identityKey, isAndroidApp, messages]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      if (storageWriteTimerRef.current !== null) {
        window.clearTimeout(storageWriteTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadApiStatus()
      .then((data: ApiStatus) => {
        if (isMounted) {
          setApiStatus(data);
        }
      })

    return () => {
      isMounted = false;
    };
  }, []);

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

  const appendAiMessage = useCallback((content: string, tone: "default" | "error" = "default", source: "voice" | "chat" = "chat") => {
    const nextMessage: Message = {
      id: crypto.randomUUID(),
      role: "ai",
      content,
      reference: tone === "default" ? extractReference(content) : undefined,
      tone,
      source,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => {
      const nextMessages = trimStoredMessages([...prev, nextMessage]);
      messagesRef.current = nextMessages;
      return nextMessages;
    });
  }, []);

  const appendVoiceUserMessage = useCallback((content: string) => {
    appendUserMessage(content, "voice");
  }, [appendUserMessage]);

  const appendVoiceAssistantMessage = useCallback((content: string) => {
    appendAiMessage(content, "default", "voice");
  }, [appendAiMessage]);

  const continueInChat = useCallback(() => {
    onModeChange?.("chat");
  }, [onModeChange]);

  const handleModeChange = useCallback((nextMode: HomeMode) => {
    if (nextMode === "voice" && isTyping) {
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
      setIsTyping(false);
    }
    onModeChange?.(nextMode);
  }, [isTyping, onModeChange]);

  const handleSend = useCallback(async (text: string) => {
    if (isTyping || apiStatus?.chatReady === false) return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

    setSpeechError(null);

    if (isRecording) {
      await speechSessionRef.current?.stop();
    }

    ttsSessionRef.current?.stop();

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;

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
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          shadowNotes,
        }),
        signal: controller.signal,
      });

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
      setIsTyping(false);
      requestControllerRef.current = null;
      if (shouldAutoFocusInputRef.current) {
        textareaRef.current?.focus();
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
  }, [handleModeChange, handleSend, hasLoadedMessages, location.pathname, location.state, navigate]);

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

      if (isNearBottomRef.current) {
        container.scrollTo({ top: container.scrollHeight, behavior });
        setShowJumpToLatest(false);
      } else {
        setShowJumpToLatest(true);
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [isKeyboardOpen, messages.length, isTyping, showQuickPrompts]);

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
    if (isTyping || chatUnavailable || isTranscribingSpeech) return;

    setSpeechError(null);

    const usesNativeDeviceSpeech = isNativePlatform() && getNativePlatform() === "android";
    if (!usesNativeDeviceSpeech && apiStatus?.speechReady === false) {
      setSpeechError("Voice input needs GROQ_API_KEY configured on the server.");
      return;
    }

    try {
      await speechSessionRef.current?.start(input);
    } catch (error) {
      setSpeechError(
        error instanceof Error ? error.message : "Speech recognition could not start.",
      );
      setIsRecording(false);
      setIsTranscribingSpeech(false);
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
      setIsTranscribingSpeech(false);
    }
  };

  const handleSpeakMessage = useCallback(async (message: Message) => {
    if (
      message.role !== "ai" ||
      message.tone === "error" ||
      !voiceSupported
    ) {
      return;
    }

    setTtsError(null);

    if (speakingMessageId === message.id) {
      ttsSessionRef.current?.stop();
      return;
    }

    try {
      await ttsSessionRef.current?.speak(message.id, message.content);
    } catch (error) {
      setTtsError(
        error instanceof Error ? error.message : "Voice playback could not start on this device.",
      );
    }
  }, [speakingMessageId, voiceSupported]);

  const toggleRecording = async () => {
    if (isRecording) {
      await stopSpeechRecognition();
      return;
    }

    await startSpeechRecognition();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-transparent">
      <header
        className={cn(
          "z-20 flex shrink-0 items-center justify-between border-b pr-14 backdrop-blur-xl transition-colors duration-200",
          isCompactPhone ? "min-h-[64px] px-4 py-2" : "min-h-[72px] px-5 py-3 sm:px-6",
        )}
        style={{
          backgroundColor: "var(--app-surface-solid)",
          backgroundImage: "var(--app-shell-highlight)",
          borderColor: "color-mix(in srgb, var(--app-divider) 50%, transparent)",
          boxShadow: "0 4px 24px rgba(0,0,0,0.08), inset 0 -1px 0 color-mix(in srgb, var(--app-divider) 40%, transparent)",
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
            <h3 className={cn("app-heading font-semibold tracking-wide", isCompactPhone ? "text-[14px]" : "text-[16px]")}>
              Bible Nova Companion
            </h3>
            <p className="app-kicker mt-0.5 truncate text-[10px]">
              {isCompactPhone ? "Private space" : "Private reflection space"}
            </p>
          </div>
        </div>
      </header>

      {onModeChange && (
        <div className="shrink-0 px-4 pt-2 sm:px-6 sm:pt-3">
          <div className="mx-auto flex w-full max-w-[680px] justify-center sm:justify-start">
            <VoiceModeToggle
              value={mode}
              onChange={handleModeChange}
              className="w-full justify-center sm:w-auto"
            />
          </div>
        </div>
      )}

      {isVoiceMode ? (
        <VoiceMode
          messages={messages}
          shadowNotes={shadowNotes}
          isTyping={isTyping}
          onAppendUserMessage={appendVoiceUserMessage}
          onAppendAssistantMessage={appendVoiceAssistantMessage}
          onAcceptShadowNotes={acceptPersistedShadowNotes}
          onContinueInChat={continueInChat}
          reservation={voiceReservation}
          onReservationChange={updateVoiceReservation}
        />
      ) : (
      <>
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className={cn(
          "app-scroll-region z-10 flex flex-1 flex-col scrollbar-hide",
          isCompactPhone ? "px-4 py-4" : "px-5 py-5 sm:px-6",
        )}
      >
        <div className={cn("mx-auto flex w-full max-w-xl flex-col", isCompactPhone ? "gap-4" : "gap-6")}>
        {showQuickPrompts && (
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

        {chatUnavailable && (
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
              <KeyRound className="w-4 h-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Setup needed
              </p>
            </div>
            <p className="app-heading text-sm leading-relaxed">
              Chat is disabled until you add `GROQ_API_KEY` to your environment.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              isAndroidApp={isAndroidApp}
              isCompactPhone={isCompactPhone}
              message={message}
              onSpeak={handleSpeakMessage}
              speakingMessageId={speakingMessageId}
              voiceSupported={voiceSupported}
            />
          ))}
        </AnimatePresence>

        {isTyping && (
          <motion.div
            initial={isAndroidApp ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex max-w-[88%] items-center gap-3"
          >
            <div className="w-[30px] h-[30px] flex-shrink-0 flex items-center justify-center">
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
          "shrink-0 border-t border-[color:color-mix(in_srgb,var(--app-divider)_50%,transparent)] transition-colors duration-300",
          isCompactPhone ? "px-4 pb-safe pt-3" : "px-5 pb-safe pt-3 sm:px-6",
        )}
        style={{
          backgroundColor: "var(--bg-base)",
          backgroundImage: "linear-gradient(180deg, color-mix(in srgb, var(--bg-base) 92%, transparent) 0%, var(--bg-base) 100%)",
        }}
      >
        <div className="mx-auto w-full max-w-xl">
          <div className="mb-2 min-h-4" aria-live="polite">{(isRecording ||
            isTranscribingSpeech ||
            speakingMessageId ||
            chatUnavailable ||
            speechError ||
            ttsError) && (
            <p
              className="mb-3 px-1 text-center text-[11px]"
              style={{
                color: speechError || ttsError ? "var(--app-danger)" : "var(--app-text-muted)",
              }}
            >
              {speechError || ttsError
                ? speechError || ttsError
                : speakingMessageId
                ? "Playing audio."
                : isRecording
                ? "Listening. Tap stop when you're done."
                : isTranscribingSpeech
                ? "Transcribing your speech..."
                : chatUnavailable
                ? "Chat will unlock after the required API key is configured."
                : ""}
            </p>
          )}</div>

          <div
            className={cn(
              "flex w-full items-end gap-2 rounded-pill border p-1.5 transition-all duration-300 focus-within:ring-2 focus-within:ring-[color:color-mix(in_srgb,var(--app-accent)_25%,transparent)] focus-within:border-[color:color-mix(in_srgb,var(--app-accent)_50%,transparent)]",
              isCompactPhone ? "pl-3.5" : "pl-4",
            )}
            style={{
              backgroundColor: "var(--app-surface-solid)",
              backgroundImage: "var(--app-shell-highlight)",
              borderColor: "color-mix(in srgb, var(--app-card-border) 80%, transparent)",
              boxShadow: "0 12px 36px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.06)",
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
              placeholder={chatUnavailable ? "Add an API key to enable chat..." : "Share your thoughts..."}
              enterKeyHint="send"
              aria-label="Message Bible Nova Companion"
              className={cn(
                "scrollbar-hide w-full resize-none bg-transparent py-3 font-sans font-light leading-[1.6] outline-none",
                isShortPhone ? "min-h-[44px] max-h-28 text-[14px]" : "min-h-[44px] max-h-32 text-[15px]",
              )}
              style={{ color: "var(--app-heading)" }}
              rows={1}
            />

            <div className="flex-shrink-0 flex items-center justify-center h-[44px] pr-1">
              {isRecording ? (
                <button
                  onClick={() => {
                    void toggleRecording();
                  }}
                  disabled={isTyping || chatUnavailable}
                  className={cn("touch-target relative flex h-[38px] w-[38px] items-center justify-center rounded-full border transition-all duration-300 active:scale-[0.97] shadow-sm", isTyping && "cursor-not-allowed opacity-50")}
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
                    "touch-target app-primary-button flex h-[38px] w-[38px] items-center justify-center rounded-full text-white transition-all active:scale-95",
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
                  disabled={isTyping || chatUnavailable || isTranscribingSpeech}
                  className={cn("touch-target relative flex h-[38px] w-[38px] items-center justify-center rounded-full border transition-all duration-300 active:scale-[0.97] shadow-sm", isTyping && "cursor-not-allowed opacity-50")}
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
