export const MAX_SHADOW_NOTES_CHARS = 4_000;

export const SHADOW_MEMORY_SECTIONS = [
  "Preferred tone",
  "Preferred language/style",
  "Recurring emotional themes",
  "Spiritual preferences",
  "Important personal context",
  "Current ongoing concern",
  "Things to avoid",
  "Recent unresolved thread",
] as const;

type ShadowMemorySection = (typeof SHADOW_MEMORY_SECTIONS)[number];

const canonicalSectionNames = new Map(
  SHADOW_MEMORY_SECTIONS.map((section) => [section.toLowerCase(), section]),
);

const compactValue = (value: string) => value.replace(/\s+/g, " ").trim();

const emptyMemoryValues = () =>
  new Map<ShadowMemorySection, string>(
    SHADOW_MEMORY_SECTIONS.map((section) => [section, ""]),
  );

const renderMemory = (values: Map<ShadowMemorySection, string>) => [
  "User memory:",
  ...SHADOW_MEMORY_SECTIONS.map((section) => {
    const value = values.get(section)?.trim() || "";
    return `- ${section}:${value ? ` ${value}` : ""}`;
  }),
].join("\n");

/**
 * Keep memory in a predictable, compact shape before it reaches storage or a
 * model prompt. Legacy free-form notes are retained under one explicit field
 * so upgrading does not silently discard useful context.
 */
export const normalizeShadowNotes = (notes: string | null | undefined) => {
  const raw = typeof notes === "string" ? notes.replace(/\r\n?/g, "\n").trim() : "";
  if (!raw) return null;

  const values = emptyMemoryValues();
  let currentSection: ShadowMemorySection | null = null;
  let foundStructuredSection = false;

  for (const line of raw.split("\n")) {
    const sectionMatch = line.match(/^\s*-\s*([^:]+):\s*(.*)$/);
    const section = sectionMatch
      ? canonicalSectionNames.get(sectionMatch[1].trim().toLowerCase())
      : undefined;

    if (section) {
      foundStructuredSection = true;
      currentSection = section;
      values.set(section, compactValue(sectionMatch?.[2] || ""));
      continue;
    }

    if (/^\s*user memory\s*:?\s*$/i.test(line)) continue;
    if (!currentSection) continue;

    const continuation = compactValue(line.replace(/^\s*[-*•]\s*/, ""));
    if (continuation) {
      const previous = values.get(currentSection) || "";
      values.set(currentSection, compactValue(`${previous} ${continuation}`));
    }
  }

  if (!foundStructuredSection) {
    values.set("Important personal context", compactValue(raw));
  }

  const fixedRenderedLength = renderMemory(emptyMemoryValues()).length;
  let remainingValueChars = Math.max(
    0,
    MAX_SHADOW_NOTES_CHARS - fixedRenderedLength,
  );
  const trimmedValues = emptyMemoryValues();

  for (const section of SHADOW_MEMORY_SECTIONS) {
    const value = values.get(section) || "";
    if (!value || remainingValueChars <= 1) continue;
    const kept = value.slice(0, remainingValueChars - 1).trimEnd();
    if (!kept) continue;
    trimmedValues.set(section, kept);
    remainingValueChars -= kept.length + 1;
  }

  return renderMemory(trimmedValues);
};
