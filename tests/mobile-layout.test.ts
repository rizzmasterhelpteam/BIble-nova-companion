import { describe, expect, it } from "vitest";
import { getChatScrollBehavior, shouldHideBottomNavigation } from "../src/lib/mobileLayout";

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
});
