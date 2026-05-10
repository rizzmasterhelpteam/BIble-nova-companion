import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mic, Send, StopCircle, AlertCircle, Sparkles, KeyRound } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion, AnimatePresence } from "motion/react";
import { useAuth } from "../context/AuthContext";

type Message = {
  id: string;
  role: "user" | "ai";
  content: string;
  reference?: string;
  tone?: "default" | "error";
};

type ApiStatus = {
  chatReady: boolean;
  prayerReady: boolean;
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

const BIBLE_BOOKS =
  /\b(Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+\d+:\d+\b/i;

const getMessageStorageKey = (identityKey: string | null) =>
  identityKey ? `bible-nova-companion-chat-${identityKey}` : null;

const extractReference = (message: string) => {
  const match = message.match(BIBLE_BOOKS);
  return match?.[0];
};

export default function Chat() {
  useDocumentTitle("Bible Nova Companion");
  const location = useLocation();
  const navigate = useNavigate();
  const { identityKey, isGuest } = useAuth();
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [hasLoadedMessages, setHasLoadedMessages] = useState(false);
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);
  const messagesRef = useRef(messages);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const storageKey = getMessageStorageKey(identityKey);
    if (!storageKey) {
      setMessages([WELCOME_MESSAGE]);
      setHasLoadedMessages(true);
      return;
    }

    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) {
        setMessages([WELCOME_MESSAGE]);
      } else {
        const parsed = JSON.parse(stored) as Message[];
        setMessages(parsed.length ? parsed : [WELCOME_MESSAGE]);
      }
    } catch {
      setMessages([WELCOME_MESSAGE]);
    }

    setHasLoadedMessages(true);
  }, [identityKey]);

  useEffect(() => {
    const storageKey = getMessageStorageKey(identityKey);
    if (!storageKey || !hasLoadedMessages) return;
    localStorage.setItem(storageKey, JSON.stringify(messages));
  }, [hasLoadedMessages, identityKey, messages]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    fetch("/api/status")
      .then((response) => response.json())
      .then((data: ApiStatus) => {
        if (isMounted) {
          setApiStatus(data);
        }
      })
      .catch(() => {
        if (isMounted) {
          setApiStatus({ chatReady: true, prayerReady: true });
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (initialized.current) return;

    if (location.state?.initialPrompt) {
      initialized.current = true;
      handleSend(location.state.initialPrompt);
      navigate(location.pathname, { replace: true, state: {} });
    } else if (location.state?.startVoice) {
      initialized.current = true;
      setIsRecording(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, isTyping]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const resizeTextarea = () => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
  };

  const handleInput = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
    resizeTextarea();
  };

  const appendAiMessage = (content: string, tone: "default" | "error" = "default") => {
    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role: "ai",
        content,
        reference: tone === "default" ? extractReference(content) : undefined,
        tone,
      },
    ]);
  };

  const handleSend = async (text: string) => {
    if (isTyping || apiStatus?.chatReady === false) return;

    const trimmedText = text.trim();
    if (!trimmedText) return;

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
    };

    const nextMessages = [...messagesRef.current, userMessage];
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setInput("");
    setIsTyping(true);
    setIsRecording(false);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let data: { message?: string; error?: string };

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
      textareaRef.current?.focus();
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      setIsRecording(false);
      window.setTimeout(() => {
        handleSend("I would appreciate some spoken guidance right now.");
      }, 300);
      return;
    }

    setIsRecording(true);
  };

  const showQuickPrompts = messages.length === 1 && !isTyping;
  const chatUnavailable = apiStatus?.chatReady === false;

  return (
    <div className="flex flex-1 flex-col relative overflow-hidden bg-transparent min-h-0">
      <header
        className="sticky top-0 z-30 flex min-h-[88px] shrink-0 items-center justify-between border-b px-6 py-4 pr-16 shadow-sm backdrop-blur-2xl transition-colors duration-300"
        style={{
          background: "color-mix(in srgb, var(--app-shell-bg) 86%, transparent)",
          borderColor: "var(--app-divider)",
        }}
      >
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="app-logo-badge flex h-[42px] w-[42px] items-center justify-center rounded-full">
              <ChristianCross className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div
              className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2"
              style={{ background: "var(--app-success)", borderColor: "var(--app-shell-bg)" }}
            />
          </div>
          <div>
            <h3 className="app-heading text-[15px] font-medium tracking-wide">
              Bible Nova Companion
            </h3>
            <p className="app-kicker mt-1 text-[10px]">
              Private reflection space
            </p>
          </div>
        </div>
      </header>

      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-6 pt-[104px] pb-[188px] space-y-6 scroll-smooth scrollbar-hide z-10"
      >
        {showQuickPrompts && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="app-panel rounded-[2rem] p-5 shadow-lg backdrop-blur-xl"
          >
            <div className="app-accent mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                Start gently
              </p>
            </div>
            <p className="app-muted mb-4 text-sm leading-relaxed">
              {isGuest
                ? "Your guidance stays on this device while you explore in guest mode."
                : "Pick a prompt to start, or write your own reflection below."}
            </p>
            <div className="flex flex-col gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSend(prompt)}
                  className="app-secondary-button rounded-2xl px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {chatUnavailable && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-[2rem] p-5 shadow-lg backdrop-blur-xl"
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
              Chat is disabled until you add `GROK_API_KEY` or `GROQ_API_KEY` to your environment.
            </p>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message) => {
            const isError = message.tone === "error";

            return (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className={cn(
                  "flex flex-col w-full",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                {message.role === "ai" && (
                  <div className="flex items-start gap-3 w-full max-w-[96%]">
                    <div
                      className={cn(
                        "w-[30px] h-[30px] mt-0.5 flex-shrink-0 rounded-full border flex items-center justify-center",
                      )}
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
                        <ChristianCross strokeWidth={1.5} className="w-[14px] h-[14px]" />
                      )}
                    </div>

                    <div className="flex flex-col gap-2 relative">
                      <div
                        className={cn(
                          "text-[16px] leading-[1.8] font-serif font-light",
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
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          transition={{ delay: 0.2 }}
                          className="mt-1"
                        >
                          <div
                            className="rounded-card border p-4 shadow-lg"
                            style={{
                              background: "var(--app-card-soft)",
                              borderColor: "color-mix(in srgb, var(--app-accent) 18%, transparent)",
                            }}
                          >
                            <p className="app-muted mb-3 text-[12px] italic font-serif">
                              A reading for contemplation.
                            </p>
                            <div
                              className="w-full rounded-xl px-4 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em]"
                              style={{
                                background: "linear-gradient(90deg, var(--app-accent-soft), transparent)",
                                color: "var(--app-accent)",
                              }}
                            >
                              <span className="app-heading px-1 font-serif normal-case tracking-normal">
                                {message.reference}
                              </span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}

                {message.role === "user" && (
                  <div
                    className="max-w-[85%] rounded-card rounded-tr-[0.5rem] border px-6 py-4 text-[15px] font-light leading-relaxed backdrop-blur-md"
                    style={{
                      background: "var(--app-card-strong)",
                      color: "var(--app-heading)",
                      borderColor: "var(--app-card-border)",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                    }}
                  >
                    {message.content}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>

        {isTyping && (
          <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center gap-3 max-w-[85%]"
          >
            <div className="w-[30px] h-[30px] flex-shrink-0 flex items-center justify-center">
              <ChristianCross strokeWidth={1} className="w-4 h-4 animate-pulse" style={{ color: "color-mix(in srgb, var(--app-accent) 60%, transparent)" }} />
            </div>
            <div className="flex items-center gap-[5px] rounded-card rounded-tl-[0.5rem] px-4 py-3" style={{ background: "var(--app-card-soft)" }}>
              {[0, 150, 300].map((delay) => (
                <motion.span
                  key={delay}
                  animate={{ y: [0, -5, 0] }}
                  transition={{
                    duration: 0.7,
                    repeat: Infinity,
                    delay: delay / 1000,
                    ease: "easeInOut",
                  }}
                  className="block h-[6px] w-[6px] rounded-full"
                  style={{ background: "var(--app-text-soft)" }}
                />
              ))}
            </div>
          </motion.div>
        )}
      </div>

      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 px-6 pb-0 pt-10 transition-colors duration-300"
        style={{ background: "linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg-base) 82%, transparent) 36%, var(--bg-base) 100%)" }}
      >
        <div className="max-w-xl mx-auto w-full relative pointer-events-auto">
          <div
            className="flex w-full items-end gap-2 rounded-pill border p-1.5 pl-4 backdrop-blur-2xl transition-all"
            style={{
              background: "var(--app-nav-bg)",
              borderColor: "var(--app-card-border)",
              boxShadow: "0 10px 34px rgba(0,0,0,0.14)",
            }}
          >
            <textarea
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
              className="scrollbar-hide min-h-[44px] max-h-32 w-full resize-none bg-transparent py-3 font-sans text-[15px] font-light leading-[1.6] outline-none"
              style={{ color: "var(--app-heading)" }}
              rows={1}
            />

            <div className="flex-shrink-0 flex items-center justify-center h-[44px] pr-1">
              {input.trim() ? (
                <button
                  onClick={() => handleSend(input)}
                  disabled={isTyping || chatUnavailable}
                  className={cn("app-primary-button flex h-[36px] w-[36px] items-center justify-center rounded-full text-white transition-all active:scale-95", isTyping && "cursor-not-allowed opacity-50 grayscale")}
                >
                  <Send strokeWidth={2} className="w-[16px] h-[16px] ml-0.5" />
                </button>
              ) : (
                <button
                  onClick={toggleRecording}
                  disabled={isTyping || chatUnavailable}
                  className={cn("relative flex h-[36px] w-[36px] items-center justify-center rounded-full border transition-all duration-300 active:scale-95", isTyping && "cursor-not-allowed opacity-50")}
                  style={
                    isRecording
                      ? {
                          background: "var(--app-danger-soft)",
                          color: "var(--app-danger)",
                          borderColor: "color-mix(in srgb, var(--app-danger) 40%, transparent)",
                        }
                      : {
                          background: "var(--app-secondary-bg)",
                          color: "var(--app-text-muted)",
                          borderColor: "var(--app-secondary-border)",
                        }
                  }
                >
                  {isRecording ? (
                    <StopCircle className="w-4 h-4" />
                  ) : (
                    <Mic strokeWidth={2} className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>

          {(isRecording || chatUnavailable) && (
            <p className="app-muted mt-3 pb-safe text-center text-[11px]">
              {isRecording
                ? "Tap again and I will turn that into a spoken-guidance request."
                : "Chat will unlock after the required API key is configured."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
