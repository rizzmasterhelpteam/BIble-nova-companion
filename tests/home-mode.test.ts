import { describe, expect, it } from "vitest";
import { getHomeModeStorageKey, parseHomeMode } from "../src/lib/homeMode";

describe("home voice/chat mode", () => {
  it("defaults new or invalid values to Voice", () => {
    expect(parseHomeMode(null)).toBe("voice");
    expect(parseHomeMode("voice")).toBe("voice");
    expect(parseHomeMode("unexpected")).toBe("voice");
  });

  it("restores Chat only when explicitly saved", () => {
    expect(parseHomeMode("chat")).toBe("chat");
  });

  it("scopes the preference to the authenticated identity", () => {
    expect(getHomeModeStorageKey("user-123")).toBe("bible-nova-companion-home-mode-user-123");
    expect(getHomeModeStorageKey(null)).toBeNull();
  });
});
