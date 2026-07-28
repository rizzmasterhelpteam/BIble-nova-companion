import { describe, expect, it } from "vitest";
import {
  getChatScrollBehavior,
  shouldForceLatestAfterModeChange,
  shouldHideBottomNavigation,
  shouldScrollChatToLatest,
} from "../src/lib/mobileLayout";

describe("mobile layout policies", () => {
  it("uses immediate scrolling while the keyboard is open", () => {
    expect(getChatScrollBehavior(true, true)).toBe("auto");
    expect(getChatScrollBehavior(true, false)).toBe("auto");
  });

  it("only smooth-scrolls when a new message changes the list", () => {
    expect(getChatScrollBehavior(false, true)).toBe("smooth");
    expect(getChatScrollBehavior(false, false)).toBe("auto");
  });

  it("hides bottom navigation while typing on a keyboard", () => {
    expect(shouldHideBottomNavigation(true)).toBe(true);
    expect(shouldHideBottomNavigation(false)).toBe(false);
  });

  it("forces the latest message only for a Voice to Chat transition", () => {
    expect(shouldForceLatestAfterModeChange("voice", "chat")).toBe(true);
    expect(shouldForceLatestAfterModeChange("chat", "chat")).toBe(false);
    expect(shouldForceLatestAfterModeChange("chat", "voice")).toBe(false);
  });

  it("respects manual history reading unless an explicit transition forces latest", () => {
    expect(shouldScrollChatToLatest(false, false)).toBe(false);
    expect(shouldScrollChatToLatest(false, true)).toBe(true);
    expect(shouldScrollChatToLatest(true, false)).toBe(true);
  });
});
