import { describe, expect, it } from "vitest";

import { getKjvCorpusStats, getKjvScriptureContext } from "../kjv-context";

describe("private KJV Scripture retrieval", () => {
  it("loads the complete KJV 1769 verse corpus", () => {
    expect(getKjvCorpusStats()).toEqual({
      translation: "KJV 1769",
      verseCount: 31_102,
    });
  });

  it("returns exact references without exposing the corpus to the client", () => {
    const context = getKjvScriptureContext("John 3:16");

    expect(context).toContain("John 3:16 (KJV 1769)");
    expect(context).toContain("For God so loved the world");
  });

  it("supports common singular Psalm references and verse ranges", () => {
    const context = getKjvScriptureContext("Psalm 23:1-3");

    expect(context).toContain("Psalms 23:1 (KJV 1769)");
    expect(context).toContain("Psalms 23:3 (KJV 1769)");
  });

  it("retrieves relevant passages for Bible topics", () => {
    const context = getKjvScriptureContext("What does the Bible say about forgiveness?");

    expect(context).toContain("KJV 1769");
    expect(context).toMatch(/forgive|forgiven|iniquity|trespass/i);
  });

  it("does not add Scripture context to unrelated questions", () => {
    expect(getKjvScriptureContext("What is the weather today?")).toBeNull();
  });
});
