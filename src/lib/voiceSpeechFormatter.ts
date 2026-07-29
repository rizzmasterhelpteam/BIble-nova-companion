export const DEFAULT_GOOGLE_TTS_SPEAKING_RATE = 0.94;
export const DEFAULT_GOOGLE_TTS_PITCH = -1;
export const GOOGLE_TTS_SENTENCE_BREAK_MS = 220;
export const GOOGLE_TTS_EMOTIONAL_BREAK_MS = 300;
export const GOOGLE_TTS_BIBLE_REFERENCE_BREAK_MS = 240;
export const GOOGLE_TTS_MAX_BREAK_MS = 450;

const MIN_GOOGLE_TTS_SPEAKING_RATE = 0.9;
const MAX_GOOGLE_TTS_SPEAKING_RATE = 1.1;
const MIN_GOOGLE_TTS_PITCH = -5;
const MAX_GOOGLE_TTS_PITCH = 5;
const MAX_SPOKEN_SENTENCE_WORDS = 28;

const BIBLE_REFERENCE_PATTERN =
  /\b(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|(?:1|2)\s+Samuel|(?:1|2)\s+Kings|(?:1|2)\s+Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|(?:1|2)\s+Corinthians|Galatians|Ephesians|Philippians|Colossians|(?:1|2)\s+Thessalonians|(?:1|2)\s+Timothy|Titus|Philemon|Hebrews|James|(?:1|2)\s+Peter|(?:1|2|3)\s+John|Jude|Revelation)\s+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?\b/gi;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const parseFiniteNumber = (
  value: string | number | null | undefined,
  fallback: number,
) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const parseGoogleTtsSpeakingRate = (
  value: string | number | null | undefined,
) =>
  clamp(
    parseFiniteNumber(value, DEFAULT_GOOGLE_TTS_SPEAKING_RATE),
    MIN_GOOGLE_TTS_SPEAKING_RATE,
    MAX_GOOGLE_TTS_SPEAKING_RATE,
  );

export const parseGoogleTtsPitch = (
  value: string | number | null | undefined,
) =>
  clamp(
    parseFiniteNumber(value, DEFAULT_GOOGLE_TTS_PITCH),
    MIN_GOOGLE_TTS_PITCH,
    MAX_GOOGLE_TTS_PITCH,
  );

export const isGoogleTtsSsmlEnabled = (
  value: string | null | undefined,
) => value?.trim().toLowerCase() !== "false";

export const escapeSsml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const countWords = (value: string) =>
  value.trim().split(/\s+/).filter(Boolean).length;

const splitLongSentence = (sentence: string): string[] => {
  if (countWords(sentence) <= MAX_SPOKEN_SENTENCE_WORDS) return [sentence];

  const candidates = [...sentence.matchAll(/[,;]\s+/g)]
    .map((match) => match.index ?? -1)
    .filter((index) => index > sentence.length * 0.32 && index < sentence.length * 0.72);
  if (!candidates.length) return [sentence];

  const midpoint = sentence.length / 2;
  const splitAt = candidates.reduce((closest, candidate) =>
    Math.abs(candidate - midpoint) < Math.abs(closest - midpoint)
      ? candidate
      : closest,
  );
  const left = sentence.slice(0, splitAt).trim().replace(/[,:;]+$/, "");
  const right = sentence.slice(splitAt + 1).trim();
  if (!left || !right) return [sentence];
  return [`${left}.`, ...splitLongSentence(right)];
};

const normalizeMarkdownLines = (value: string) => {
  const lines = value
    .split(/\r?\n/)
    .map((line) =>
      line
        .trimStart()
        .replace(/^\s{0,3}#{1,6}\s+/, "")
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
        .replace(/^\s*>\s?/, "")
        .trim(),
    )
    .filter(Boolean);
  return lines
    .map((line, index) =>
      index < lines.length - 1 && !/[.!?]$/.test(line)
        ? `${line}.`
        : line,
    )
    .join(" ");
};

export const normalizeVoiceSpeech = (value: string) => {
  const markdownFree = normalizeMarkdownLines(
    value
      .replace(/```(?:[\w-]+)?\s*/g, "")
      .replace(/```/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/<https?:\/\/[^>]+>/gi, "the link")
      .replace(/https?:\/\/[^\s)>\]]+/gi, (url) => {
        const trailingPunctuation = url.match(/[.,!?]+$/)?.[0] || "";
        return `the link${trailingPunctuation}`;
      })
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<\/?[^>]+>/g, "")
      .replace(/[*_~]/g, ""),
  );

  const punctuationNormalized = markdownFree
    .replace(/[–—]\s*/g, ", ")
    .replace(/;/g, ".")
    .replace(/\.{3,}/g, ".")
    .replace(/([!?])(?:\s*\1)+/g, "$1")
    .replace(/,{2,}/g, ",")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  const sentences =
    punctuationNormalized.match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) || [];
  return sentences.flatMap(splitLongSentence).join(" ").trim();
};

const isEmotionalOpening = (sentence: string) =>
  /^(?:I hear you|That sounds|I'm here with you|I am here with you|Let's slow this down|You are not alone|You're not alone)\b/i
    .test(sentence.trim());

const addBibleReferencePause = (sentence: string) => {
  let cursor = 0;
  let result = "";
  BIBLE_REFERENCE_PATTERN.lastIndex = 0;
  for (const match of sentence.matchAll(BIBLE_REFERENCE_PATTERN)) {
    const index = match.index ?? 0;
    const matchEnd = index + match[0].length;
    result += escapeSsml(sentence.slice(cursor, matchEnd));
    if (sentence.slice(matchEnd).replace(/[.!?]/g, "").trim()) {
      result += `<break time="${GOOGLE_TTS_BIBLE_REFERENCE_BREAK_MS}ms"/>`;
    }
    cursor = matchEnd;
  }
  return result + escapeSsml(sentence.slice(cursor));
};

const formatSsmlNumber = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");

export const createGoogleTtsSsml = (
  value: string,
  options: {
    speakingRate?: string | number | null;
    pitch?: string | number | null;
  } = {},
) => {
  const normalizedText = normalizeVoiceSpeech(value);
  if (!normalizedText) return "";

  const speakingRate = parseGoogleTtsSpeakingRate(options.speakingRate);
  const pitch = parseGoogleTtsPitch(options.pitch);
  const ratePercent = Math.round(speakingRate * 100);
  const pitchValue = `${pitch > 0 ? "+" : ""}${formatSsmlNumber(pitch)}st`;
  const sentences =
    normalizedText.match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((sentence) => sentence.trim())
      .filter(Boolean) || [normalizedText];

  const spokenSentences = sentences.map((sentence, index) => {
    const sentenceMarkup = `<s>${addBibleReferencePause(sentence)}</s>`;
    if (index === sentences.length - 1) return sentenceMarkup;
    const requestedBreak = index === 0 && isEmotionalOpening(sentence)
      ? GOOGLE_TTS_EMOTIONAL_BREAK_MS
      : GOOGLE_TTS_SENTENCE_BREAK_MS;
    const breakMs = Math.min(GOOGLE_TTS_MAX_BREAK_MS, requestedBreak);
    return `${sentenceMarkup}<break time="${breakMs}ms"/>`;
  });

  return `<speak><prosody rate="${ratePercent}%" pitch="${pitchValue}">${spokenSentences.join("")}</prosody></speak>`;
};
