import { describe, expect, it } from "vitest";
import { resolvePerformanceMode } from "../src/hooks/usePerformanceMode";

describe("performance mode", () => {
  it("enables for Android and reduced-motion environments", () => {
    expect(resolvePerformanceMode({
      isAndroid: true,
      prefersReducedMotion: false,
    })).toBe(true);
    expect(resolvePerformanceMode({
      isAndroid: false,
      prefersReducedMotion: true,
    })).toBe(true);
  });

  it("honors explicit profiling overrides", () => {
    expect(resolvePerformanceMode({
      isAndroid: true,
      prefersReducedMotion: true,
      override: false,
    })).toBe(false);
  });
});
