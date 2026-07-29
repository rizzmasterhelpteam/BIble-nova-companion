import { describe, expect, it } from "vitest";

import {
  MAX_SHADOW_NOTES_CHARS,
  normalizeShadowNotes,
  SHADOW_MEMORY_SECTIONS,
} from "../src/lib/shadowMemory";

describe("structured shadow memory", () => {
  it("supports the 4,000-character storage budget", () => {
    const notes = normalizeShadowNotes(
      `User memory:\n- Preferred tone: ${"warm ".repeat(900)}`,
    );

    expect(MAX_SHADOW_NOTES_CHARS).toBe(4_000);
    expect(notes).not.toBeNull();
    expect(notes!.length).toBeLessThanOrEqual(MAX_SHADOW_NOTES_CHARS);
    expect(notes).toContain("User memory:");
    expect(notes).toContain("- Preferred tone:");
  });

  it("safely trims oversized notes without losing the bullet schema", () => {
    const notes = normalizeShadowNotes("private context ".repeat(1_000));

    expect(notes).not.toBeNull();
    expect(notes!.length).toBeLessThanOrEqual(MAX_SHADOW_NOTES_CHARS);
    expect(notes).toMatch(/^User memory:\n/);
    for (const section of SHADOW_MEMORY_SECTIONS) {
      expect(notes).toContain(`- ${section}:`);
    }
  });

  it("does not log or preserve a transcript-shaped field", () => {
    const notes = normalizeShadowNotes(
      "User memory:\n- Preferred tone: warm\n- Current ongoing concern: finding a stable routine",
    );

    expect(notes).toContain("- Preferred tone: warm");
    expect(notes).not.toContain("USER:");
    expect(notes).not.toContain("ASSISTANT:");
  });
});
