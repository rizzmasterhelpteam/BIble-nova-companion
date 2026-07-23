import { createRequire } from "node:module";

type KJVVerseMap = Record<string, string>;

const require = createRequire(import.meta.url);
const KJV_VERSES = require("kjv/json/verses-1769.json") as KJVVerseMap;
const MAX_REFERENCE_PASSAGES = 6;
const MAX_SEARCH_PASSAGES = 5;
const MAX_CONTEXT_CHARS = 4_800;

const KJV_BOOKS = [
  "1 Samuel",
  "2 Samuel",
  "1 Kings",
  "2 Kings",
  "1 Chronicles",
  "2 Chronicles",
  "Ezra",
  "Nehemiah",
  "Esther",
  "Job",
  "Psalms",
  "Proverbs",
  "Ecclesiastes",
  "Song of Solomon",
  "Isaiah",
  "Jeremiah",
  "Lamentations",
  "Ezekiel",
  "Daniel",
  "Hosea",
  "Joel",
  "Amos",
  "Obadiah",
  "Jonah",
  "Micah",
  "Nahum",
  "Habakkuk",
  "Zephaniah",
  "Haggai",
  "Zechariah",
  "Malachi",
  "Matthew",
  "Mark",
  "Luke",
  "John",
  "Acts",
  "Romans",
  "1 Corinthians",
  "2 Corinthians",
  "Galatians",
  "Ephesians",
  "Philippians",
  "Colossians",
  "1 Thessalonians",
  "2 Thessalonians",
  "1 Timothy",
  "2 Timothy",
  "Titus",
  "Philemon",
  "Hebrews",
  "James",
  "1 Peter",
  "2 Peter",
  "1 John",
  "2 John",
  "3 John",
  "Jude",
  "Revelation",
];

const BOOK_ALIASES: Record<string, string> = {
  Psalm: "Psalms",
  "Song of Songs": "Song of Solomon",
};

const BOOK_NAME_PATTERN = [...KJV_BOOKS, ...Object.keys(BOOK_ALIASES)]
  .sort((left, right) => right.length - left.length)
  .map((book) => book.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const REFERENCE_PATTERN = new RegExp(
  `\\b(${BOOK_NAME_PATTERN})\\s+(\\d{1,3})(?::(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?\\b`,
  "gi",
);

const CANONICAL_BOOKS = new Map(
  [
    ...KJV_BOOKS.map((book) => [book.toLowerCase().replace(/\s+/g, " "), book] as const),
    ...Object.entries(BOOK_ALIASES).map(([alias, book]) => [alias.toLowerCase(), book] as const),
  ],
);

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "are",
  "because",
  "being",
  "can",
  "could",
  "do",
  "does",
  "from",
  "how",
  "have",
  "into",
  "is",
  "its",
  "just",
  "more",
  "much",
  "may",
  "of",
  "on",
  "our",
  "please",
  "question",
  "say",
  "should",
  "tell",
  "that",
  "the",
  "their",
  "them",
  "there",
  "this",
  "what",
  "when",
  "which",
  "with",
  "were",
  "where",
  "who",
  "why",
  "would",
  "you",
  "your",
]);

const BIBLE_SIGNAL_WORDS = new Set([
  "bible",
  "scripture",
  "verse",
  "chapter",
  "gospel",
  "psalm",
  "proverb",
  "jesus",
  "christ",
  "god",
  "lord",
  "moses",
  "david",
  "paul",
  "peter",
  "mary",
  "abraham",
  "faith",
  "prayer",
  "sin",
  "grace",
  "salvation",
  "forgiveness",
  "forgive",
  "heaven",
  "hell",
  "church",
  "christian",
]);

const TOPIC_EXPANSIONS: Record<string, string[]> = {
  anxious: ["careful", "fear", "troubled", "worry"],
  anxiety: ["careful", "fear", "troubled", "worry"],
  stress: ["careful", "burden", "troubled", "rest"],
  worry: ["careful", "fear", "troubled", "worry"],
  lonely: ["comfort", "forsake", "refuge", "presence"],
  depression: ["brokenhearted", "sorrow", "comfort", "hope"],
  forgiveness: ["forgive", "forgiven", "iniquity", "trespass"],
  forgive: ["forgive", "forgiven", "iniquity", "trespass"],
  purpose: ["will", "work", "calling", "plan"],
  money: ["rich", "wealth", "mammon", "money"],
  relationship: ["love", "kindness", "husband", "wife"],
  marriage: ["love", "husband", "wife", "marriage"],
  grief: ["mourn", "sorrow", "comfort", "weep"],
};

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getMeaningfulTerms = (query: string) =>
  [...new Set(normalizeText(query)
    .split(" ")
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)))];

const cleanVerseText = (text: string) =>
  text
    .replace(/#/g, "")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

const formatPassages = (references: string[]) => {
  const lines = references.map((reference) => `${reference} (KJV 1769): ${cleanVerseText(KJV_VERSES[reference])}`);
  const context = [
    "The following passages are retrieved from the King James Version 1769.",
    ...lines,
  ].join("\n");
  return context.slice(0, MAX_CONTEXT_CHARS);
};

const getReferencePassages = (query: string) => {
  const references: string[] = [];
  const normalizedQuery = query.replace(/[\u2013\u2014]/g, "-");
  for (const match of normalizedQuery.matchAll(REFERENCE_PATTERN)) {
    const book = CANONICAL_BOOKS.get(match[1].toLowerCase().replace(/\s+/g, " "));
    const chapter = Number(match[2]);
    const verse = match[3] ? Number(match[3]) : null;
    const endVerse = match[4] ? Number(match[4]) : verse;
    if (!book || !Number.isInteger(chapter)) continue;

    if (verse === null) {
      for (const reference of Object.keys(KJV_VERSES)) {
        if (reference.startsWith(`${book} ${chapter}:`)) references.push(reference);
        if (references.length >= MAX_REFERENCE_PASSAGES) break;
      }
    } else {
      const lastVerse = Math.max(verse, endVerse || verse);
      for (let verseNumber = verse; verseNumber <= lastVerse && references.length < MAX_REFERENCE_PASSAGES; verseNumber += 1) {
        const reference = `${book} ${chapter}:${verseNumber}`;
        if (KJV_VERSES[reference]) references.push(reference);
      }
    }

    if (references.length >= MAX_REFERENCE_PASSAGES) break;
  }

  return [...new Set(references)];
};

const getKeywordPassages = (query: string) => {
  const rawTerms = getMeaningfulTerms(query);
  const isBibleRelated = rawTerms.some((term) => BIBLE_SIGNAL_WORDS.has(term));
  if (!isBibleRelated) return [];

  const searchTerms = new Set(rawTerms);
  rawTerms.forEach((term) => TOPIC_EXPANSIONS[term]?.forEach((expandedTerm) => searchTerms.add(expandedTerm)));

  return Object.entries(KJV_VERSES)
    .map(([reference, text]) => {
      const normalizedVerse = normalizeText(text);
      const matches = [...searchTerms].filter((term) => normalizedVerse.includes(term)).length;
      if (!matches) return null;
      return {
        reference,
        score: matches + (normalizedVerse.includes(normalizeText(query)) ? 2 : 0),
      };
    })
    .filter((result): result is { reference: string; score: number } => Boolean(result))
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_SEARCH_PASSAGES)
    .map(({ reference }) => reference);
};

export const getKjvScriptureContext = (query: string) => {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return null;

  const referencedPassages = getReferencePassages(normalizedQuery);
  const references = referencedPassages.length ? referencedPassages : getKeywordPassages(normalizedQuery);
  return references.length ? formatPassages(references) : null;
};

export const getKjvCorpusStats = () => ({
  translation: "KJV 1769",
  verseCount: Object.keys(KJV_VERSES).length,
});
