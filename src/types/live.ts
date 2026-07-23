export type HomeMode = "voice" | "chat";

export type VoiceState =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "ready"
  | "listening"
  | "user-speaking"
  | "thinking"
  | "assistant-speaking"
  | "interrupted"
  | "reconnecting"
  | "ending"
  | "ended"
  | "permission-denied"
  | "offline"
  | "error";

export type ConversationMessage = {
  id: string;
  role: "user" | "ai";
  content: string;
  reference?: string;
  tone?: "default" | "error";
  source?: "voice" | "chat";
  createdAt?: string;
};
