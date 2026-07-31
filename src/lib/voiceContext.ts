import type { ConversationMessage } from "../types/live";

export const normalizeVoiceContextMessages = (messages: ConversationMessage[]) =>
  messages
    .filter((message) => message.content.trim())
    .slice(-24)
    .map((message) => ({
      role: message.role === "ai" ? "ai" as const : "user" as const,
      content:
        message.role === "ai" && message.playbackStatus === "interrupted"
          ? `[Voice playback note: this assistant reply was interrupted before the user necessarily heard all of it. Do not assume it was fully heard.]\n${message.content.trim()}`
          : message.content.trim(),
    }));
