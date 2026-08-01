import type { VoicePlaybackMetadata } from "../types/live";

export type LiveCaptionSpeaker = "You" | "Bible Nova";
export type LiveCaptionPhase = "interim" | "stable" | "final" | "interrupted";

export type LiveCaption = {
  turnId: number;
  speaker: LiveCaptionSpeaker;
  text: string;
  phase: LiveCaptionPhase;
  revision: number;
};

type Turn = {
  id: number;
  speaker: LiveCaptionSpeaker;
  stableText: string;
  interimText: string;
  complete: boolean;
  committed: boolean;
  interrupted: boolean;
  audioStarted: boolean;
  audioDrained: boolean;
  visibleWordCount: number;
  revision: number;
};

type CaptionControllerOptions = {
  onCaption: (caption: LiveCaption | null) => void;
  onUserFinal: (text: string) => void;
  onAssistantFinal: (text: string, playback: VoicePlaybackMetadata) => string | void;
  onAssistantPlaybackComplete: (messageId: string) => void;
  onTranscriptUnavailable: () => void;
  setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};

const MAX_TRANSCRIPT_CHARS = 8_000;
const UI_UPDATE_MS = 120;
const ORDERING_GRACE_MS = 650;
const FINAL_CAPTION_HOLD_MS = 900;
const ASSISTANT_SUBTITLE_TICK_MS = 140;

const cleanDisplay = (value: string) => value.trim().replace(/\s+/g, " ").slice(0, MAX_TRANSCRIPT_CHARS);

const compareText = (value: string) => cleanDisplay(value)
  .toLocaleLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/\b(i)\s+am\b/g, "$1'm")
  .replace(/\b(you|we|they)\s+are\b/g, "$1're")
  .replace(/\b(do|does|did|can|will|is|are|was|were|have|has|had)\s+not\b/g, "$1n't")
  .replace(/['’]/g, "")
  .replace(/[^\p{L}\p{N}\s]/gu, "")
  .replace(/\s+/g, " ")
  .trim();

const overlapWords = (current: string[], next: string[]) => {
  for (let length = Math.min(current.length, next.length); length > 0; length -= 1) {
    if (current.slice(-length).join(" ") === next.slice(0, length).join(" ")) return length;
  }
  return 0;
};

export const reconcileTranscriptHypothesis = (current: string, next: string) => {
  const existing = cleanDisplay(current);
  const incoming = cleanDisplay(next);
  if (!incoming) return existing;
  if (!existing) return incoming;
  const existingComparable = compareText(existing);
  const incomingComparable = compareText(incoming);
  if (!incomingComparable) return existing;
  if (incomingComparable === existingComparable) return incoming;
  if (incomingComparable.startsWith(existingComparable)) return incoming;
  if (existingComparable.startsWith(incomingComparable)) return existing;

  const existingWords = existingComparable.split(" ");
  const incomingWords = incomingComparable.split(" ");
  const overlap = overlapWords(existingWords, incomingWords);
  if (overlap) return cleanDisplay(`${existing} ${incoming.split(/\s+/).slice(overlap).join(" ")}`);

  // Some speech engines split a word at a packet boundary ("worr" + "worry").
  const maxPartial = Math.min(12, existingComparable.length, incomingComparable.length);
  for (let length = maxPartial; length >= 3; length -= 1) {
    if (existingComparable.endsWith(incomingComparable.slice(0, length))) {
      return cleanDisplay(`${existing}${incoming.slice(length)}`);
    }
  }
  return cleanDisplay(`${existing} ${incoming}`);
};

const getWords = (text: string) => {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: new (...args: never[]) => { segment: (value: string) => Iterable<{ segment: string; isWordLike?: boolean }> } }).Segmenter;
  if (Segmenter) {
    return [...new Segmenter(undefined, { granularity: "word" }).segment(text)]
      .filter((part) => part.isWordLike)
      .map((part) => part.segment);
  }
  return text.match(/[^\s]+/g) || [];
};

export const segmentLiveCaption = (value: string, maxChars = 180, maxWords = 32) => {
  const text = cleanDisplay(value);
  if (!text) return "";
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const preferred = sentences.at(-1) || text;
  if (preferred.length <= maxChars && getWords(preferred).length <= maxWords) return preferred;
  const words = getWords(text);
  const selected: string[] = [];
  for (const word of words.reverse()) {
    const proposed = [word, ...selected].join(" ");
    if (selected.length && (proposed.length > maxChars || selected.length >= maxWords)) break;
    selected.unshift(word);
  }
  return selected.join(" ") || words.at(-1) || "";
};

const captionTokens = (value: string) => cleanDisplay(value).match(/\S+/gu) || [];

export const createRollingCaption = (
  transcript: string,
  options: { maxWords?: number; maxChars?: number } = {},
) => {
  const maxWords = options.maxWords ?? 18;
  const maxChars = options.maxChars ?? 110;
  const tokens = captionTokens(transcript);
  const selected: string[] = [];
  for (const token of tokens.reverse()) {
    const proposed = [token, ...selected].join(" ");
    if (selected.length && (selected.length >= maxWords || proposed.length > maxChars)) break;
    selected.unshift(token);
  }
  return selected.join(" ") || tokens.at(-1) || "";
};

export class LiveCaptionController {
  private generation = 0;
  private turnId = 0;
  private user: Turn | null = null;
  private assistant: Turn | null = null;
  private assistantMessageId: string | null = null;
  private visualTimer: ReturnType<typeof setTimeout> | null = null;
  private userFinalTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantFinalTimer: ReturnType<typeof setTimeout> | null = null;
  private assistantProgressTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingVisual = false;
  private turnCompleted = false;
  private readonly setTimer: NonNullable<CaptionControllerOptions["setTimer"]>;
  private readonly clearTimer: NonNullable<CaptionControllerOptions["clearTimer"]>;

  constructor(private readonly options: CaptionControllerOptions) {
    this.setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
    this.clearTimer = options.clearTimer || ((timer) => clearTimeout(timer));
  }

  beginGeneration() {
    this.cleanup();
    this.generation += 1;
    this.user = null;
    this.assistant = null;
    this.assistantMessageId = null;
    this.turnCompleted = false;
    this.options.onCaption(null);
  }

  cleanup() {
    [this.visualTimer, this.userFinalTimer, this.assistantFinalTimer, this.assistantProgressTimer, this.holdTimer].forEach((timer) => {
      if (timer !== null) this.clearTimer(timer);
    });
    this.visualTimer = null;
    this.userFinalTimer = null;
    this.assistantFinalTimer = null;
    this.assistantProgressTimer = null;
    this.holdTimer = null;
    this.pendingVisual = false;
  }

  receiveUserInterim(text: string) {
    this.cancelAssistantPresentation();
    const turn = this.ensureUser();
    if (turn.complete || turn.interrupted) return;
    turn.interimText = reconcileTranscriptHypothesis(turn.stableText || turn.interimText, text);
    turn.revision += 1;
    this.debug("user-interim", turn);
    this.queueVisual(turn);
  }

  receiveUserStable(text: string, finished = false) {
    const turn = this.user && this.user.complete && !this.user.interrupted
      ? this.user
      : this.ensureUser();
    if (turn.committed || turn.interrupted) return;
    turn.stableText = reconcileTranscriptHypothesis(turn.stableText, text);
    turn.interimText = "";
    turn.revision += 1;
    this.debug("user-stable", turn);
    this.queueVisual(turn, finished);
    if (finished || turn.complete) this.finishUser();
  }

  finishUser() {
    const turn = this.user;
    if (!turn || turn.committed || turn.interrupted) return;
    turn.complete = true;
    this.debug("user-complete", turn);
    this.queueVisual(turn, true);
    const capturedGeneration = this.generation;
    const finalize = () => {
      if (capturedGeneration !== this.generation || this.user !== turn || turn.committed) return;
      const text = cleanDisplay(turn.stableText || turn.interimText);
      turn.committed = true;
      if (text) this.options.onUserFinal(text);
    };
    this.scheduleUserFinal(finalize);
  }

  receiveAssistantText(text: string) {
    const turn = this.ensureAssistant();
    if (turn.interrupted || turn.committed) return;
    turn.stableText = reconcileTranscriptHypothesis(turn.stableText, text);
    turn.revision += 1;
    this.debug("assistant-transcript", turn);
    if (turn.audioStarted) this.startAssistantProgression(turn);
    if (turn.complete) this.scheduleAssistantFinalization();
  }

  assistantAudioStarted() {
    const turn = this.ensureAssistant();
    if (turn.interrupted) return;
    turn.audioStarted = true;
    this.debug("assistant-audio-start", turn);
    this.startAssistantProgression(turn);
    if (turn.complete) this.scheduleAssistantFinalization();
  }

  assistantAudioDrained() {
    const turn = this.assistant;
    if (!turn || turn.interrupted) return;
    turn.audioDrained = true;
    this.debug("assistant-audio-drained", turn);
    turn.visibleWordCount = captionTokens(turn.stableText).length;
    this.queueVisual(turn, true);
    this.cancelAssistantProgression();
    if (this.assistantMessageId) this.options.onAssistantPlaybackComplete(this.assistantMessageId);
    this.scheduleAssistantFinalization();
  }

  turnComplete() {
    this.turnCompleted = true;
    this.finishUser();
    const turn = this.assistant;
    if (turn && !turn.interrupted) {
      turn.complete = true;
      this.scheduleAssistantFinalization();
    }
  }

  interruptAssistant() {
    const turn = this.assistant;
    if (!turn) return;
    if (!turn.committed) {
      const text = cleanDisplay(turn.stableText);
      turn.committed = true;
      if (text) {
        const id = this.options.onAssistantFinal(text, { playbackStatus: "interrupted" });
        this.assistantMessageId = typeof id === "string" ? id : null;
      }
    }
    this.cancelAssistantPresentation();
    turn.interrupted = true;
    this.debug("assistant-interrupted", turn);
    if (this.assistantFinalTimer !== null) this.clearTimer(this.assistantFinalTimer);
    this.assistantFinalTimer = null;
    if (this.holdTimer !== null) this.clearTimer(this.holdTimer);
    this.holdTimer = null;
    this.assistantMessageId = null;
  }

  private ensureUser() {
    if (!this.user || this.user.complete || this.user.interrupted) {
      this.turnCompleted = false;
      if (this.assistant?.complete) this.assistant = null;
      this.user = this.newTurn("You");
    }
    return this.user;
  }

  private ensureAssistant() {
    if (!this.assistant || this.assistant.interrupted) {
      this.assistant = this.newTurn("Bible Nova");
      this.assistant.complete = this.turnCompleted;
    }
    return this.assistant;
  }

  private newTurn(speaker: LiveCaptionSpeaker): Turn {
    return {
      id: ++this.turnId,
      speaker,
      stableText: "",
      interimText: "",
      complete: false,
      committed: false,
      interrupted: false,
      audioStarted: false,
      audioDrained: false,
      visibleWordCount: 0,
      revision: 0,
    };
  }

  private queueVisual(turn: Turn, flush = false) {
    if (turn.interrupted || (turn.speaker === "Bible Nova" && !turn.audioStarted)) return;
    const emit = () => {
      this.visualTimer = null;
      this.pendingVisual = false;
      if (turn.interrupted) return;
      const fullText = turn.stableText || turn.interimText;
      const visibleText = turn.speaker === "Bible Nova"
        ? captionTokens(fullText).slice(0, turn.visibleWordCount).join(" ")
        : fullText;
      const text = createRollingCaption(visibleText);
      if (!text) return;
      this.options.onCaption({
        turnId: turn.id,
        speaker: turn.speaker,
        text,
        phase: turn.complete ? "final" : turn.stableText ? "stable" : "interim",
        revision: turn.revision,
      });
    };
    if (flush) {
      if (this.visualTimer !== null) this.clearTimer(this.visualTimer);
      emit();
    } else if (!this.pendingVisual) {
      const capturedGeneration = this.generation;
      this.pendingVisual = true;
      this.visualTimer = this.setTimer(() => {
        if (capturedGeneration === this.generation) emit();
      }, UI_UPDATE_MS);
    }
  }

  private scheduleUserFinal(callback: () => void) {
    if (this.userFinalTimer !== null) this.clearTimer(this.userFinalTimer);
    const capturedGeneration = this.generation;
    this.userFinalTimer = this.setTimer(() => {
      this.userFinalTimer = null;
      if (capturedGeneration === this.generation) callback();
    }, ORDERING_GRACE_MS);
  }

  private scheduleAssistantFinal(callback: () => void) {
    if (this.assistantFinalTimer !== null) this.clearTimer(this.assistantFinalTimer);
    const capturedGeneration = this.generation;
    this.assistantFinalTimer = this.setTimer(() => {
      this.assistantFinalTimer = null;
      if (capturedGeneration === this.generation) callback();
    }, ORDERING_GRACE_MS);
  }

  private scheduleAssistantFinalization() {
    const turn = this.assistant;
    if (!turn || turn.committed || turn.interrupted || !turn.complete || !turn.audioDrained) return;
    const finalize = () => {
      if (turn.committed || turn.interrupted || this.assistant !== turn) return;
      const text = cleanDisplay(turn.stableText);
      turn.committed = true;
      if (text) {
        const id = this.options.onAssistantFinal(text, { playbackStatus: "completed" });
        this.assistantMessageId = typeof id === "string" ? id : null;
        if (turn.audioDrained && this.assistantMessageId) {
          this.options.onAssistantPlaybackComplete(this.assistantMessageId);
        }
        this.queueVisual(turn, true);
      } else if (turn.audioDrained) {
        this.options.onTranscriptUnavailable();
      }
      if (turn.audioDrained && text) this.scheduleCaptionHold(turn);
    };
    this.scheduleAssistantFinal(finalize);
  }

  private scheduleCaptionHold(turn: Turn) {
    const capturedGeneration = this.generation;
    this.holdTimer = this.setTimer(() => {
      if (capturedGeneration === this.generation && this.assistant === turn && !turn.interrupted) {
        this.options.onCaption(null);
      }
    }, FINAL_CAPTION_HOLD_MS);
  }

  private startAssistantProgression(turn: Turn) {
    if (turn.interrupted || !turn.audioStarted) return;
    const availableWords = captionTokens(turn.stableText);
    if (!availableWords.length) return;
    if (!turn.visibleWordCount) turn.visibleWordCount = Math.min(3, availableWords.length);
    this.queueVisual(turn, true);
    if (turn.visibleWordCount >= availableWords.length || this.assistantProgressTimer !== null) return;
    const capturedGeneration = this.generation;
    this.assistantProgressTimer = this.setTimer(() => {
      this.assistantProgressTimer = null;
      if (capturedGeneration !== this.generation || turn !== this.assistant || turn.interrupted) return;
      const total = captionTokens(turn.stableText).length;
      const lag = total - turn.visibleWordCount;
      if (lag <= 0) return;
      turn.visibleWordCount = Math.min(total, turn.visibleWordCount + (lag > 6 ? 2 : 1));
      this.queueVisual(turn, true);
      this.startAssistantProgression(turn);
    }, ASSISTANT_SUBTITLE_TICK_MS);
  }

  private cancelAssistantProgression() {
    if (this.assistantProgressTimer !== null) this.clearTimer(this.assistantProgressTimer);
    this.assistantProgressTimer = null;
  }

  private cancelAssistantPresentation() {
    this.cancelAssistantProgression();
    if (this.visualTimer !== null) this.clearTimer(this.visualTimer);
    this.visualTimer = null;
    this.pendingVisual = false;
    if (this.holdTimer !== null) this.clearTimer(this.holdTimer);
    this.holdTimer = null;
    if (this.assistant?.audioStarted && !this.assistant.interrupted) this.options.onCaption(null);
  }

  private debug(event: string, turn: Turn) {
    if (!import.meta.env.DEV || import.meta.env.MODE === "test") return;
    console.debug("[Voice captions]", {
      event,
      turnId: turn.id,
      generation: this.generation,
      speaker: turn.speaker,
      phase: turn.interrupted ? "interrupted" : turn.complete ? "final" : turn.stableText ? "stable" : "interim",
      fullWordCount: captionTokens(turn.stableText || turn.interimText).length,
      visibleWordCount: turn.visibleWordCount,
      committed: turn.committed,
      audioStarted: turn.audioStarted,
      audioDrained: turn.audioDrained,
    });
  }
}
