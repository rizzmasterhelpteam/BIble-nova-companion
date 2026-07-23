import type { ConversationMessage } from "../types/live";

const LIVE_CONTEXT_MESSAGES = 8;

type RealtimeInputSession = {
  sendRealtimeInput: (params: { audioStreamEnd?: boolean }) => void;
};

export const mergeLiveTranscript = (current: string, next: string) => {
  const normalizedNext = next.trim().replace(/\s+/g, " ");
  if (!normalizedNext) return current;
  if (!current) return normalizedNext;
  if (normalizedNext.startsWith(current)) return normalizedNext;
  if (current.endsWith(normalizedNext)) return current;
  return `${current} ${normalizedNext}`.trim();
};

export const createInitialHistoryPayload = (history: ConversationMessage[]) => {
  const turns = history
    .filter((message) => message.id !== "welcome" && message.tone !== "error")
    .slice(-LIVE_CONTEXT_MESSAGES)
    .map((message) => ({
      role: message.role === "ai" ? "model" : "user",
      parts: [{ text: message.content.slice(0, 2_000) }],
    }));

  if (!turns.length) return null;
  return {
    turns,
    turnComplete: turns.at(-1)?.role === "user",
  };
};

export const signalAudioStreamEnd = (
  session: RealtimeInputSession | null,
  alreadyEnded: boolean,
) => {
  if (!session || alreadyEnded) return alreadyEnded;

  try {
    session.sendRealtimeInput({ audioStreamEnd: true });
    return true;
  } catch {
    return alreadyEnded;
  }
};

export const shouldResumeListeningAfterPlayback = ({
  playbackGeneration,
  currentGeneration,
  stopRequested,
  remainingSources,
}: {
  playbackGeneration: number;
  currentGeneration: number;
  stopRequested: boolean;
  remainingSources: number;
}) =>
  playbackGeneration === currentGeneration &&
  !stopRequested &&
  remainingSources === 0;

export const shouldReconnectLiveSession = (
  completedAttempts: number,
  maxAttempts: number,
) => completedAttempts < maxAttempts;

export const getLiveReconnectDelay = (attempt: number) =>
  700 * Math.max(1, attempt);
