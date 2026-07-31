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

export type VoicePlaybackStatus =
  | "pending"
  | "completed"
  | "interrupted"
  | "failed";

export type VoicePlaybackMetadata = {
  playbackStatus: VoicePlaybackStatus;
  interruptedAtMs?: number;
  audioDurationMs?: number;
};

export type VoiceUsageSummary = {
  monthlyLimitMinutes: number;
  monthlyUsedMinutes: number;
  monthlyRemainingMinutes: number;
  monthlyResetAt: string | null;
};

export type ConversationMessage = {
  id: string;
  role: "user" | "ai";
  content: string;
  reference?: string;
  tone?: "default" | "error";
  source?: "voice" | "chat";
  createdAt?: string;
  playbackStatus?: VoicePlaybackStatus;
  interruptedAtMs?: number;
  audioDurationMs?: number;
};
