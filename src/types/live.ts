export type HomeMode = "voice" | "chat";

export type VoiceState =
  | "idle"
  | "requesting-permission"
  | "connecting"
  | "ready"
  | "listening"
  | "user-speaking"
  | "finishing-user-turn"
  | "transcribing"
  | "thinking"
  | "preparing-voice"
  | "assistant-speaking"
  | "barge-in-listening"
  | "interrupted"
  | "restarting-listener"
  | "paused"
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
