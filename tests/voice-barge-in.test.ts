import { describe, expect, it } from "vitest";
import {
  AdaptiveBargeInDetector,
  calculateVoiceRms,
} from "../src/lib/voiceBargeIn";

describe("adaptive Voice barge-in detector", () => {
  it("requires sustained speech and ignores clicks and room noise", () => {
    const detector = new AdaptiveBargeInDetector({
      initialNoiseFloor: 0.01,
    });

    detector.observeAmbient(0.009);
    expect(detector.observePlayback(0.04, 0)).toBe(false);
    expect(detector.observePlayback(0.01, 40)).toBe(false);
    expect(detector.observePlayback(0.04, 100)).toBe(false);
    expect(detector.observePlayback(0.04, 279)).toBe(false);
    expect(detector.observePlayback(0.04, 280)).toBe(true);
  });

  it("adapts above a steady ambient floor and applies a trigger cooldown", () => {
    const detector = new AdaptiveBargeInDetector({
      initialNoiseFloor: 0.01,
    });
    for (let index = 0; index < 30; index += 1) {
      detector.observeAmbient(0.02);
    }

    expect(detector.getNoiseFloor()).toBeGreaterThan(0.017);
    expect(detector.getThreshold()).toBeGreaterThan(0.037);
    expect(detector.observePlayback(0.03, 0)).toBe(false);
    expect(detector.observePlayback(0.05, 100)).toBe(false);
    expect(detector.observePlayback(0.05, 280)).toBe(true);
    expect(detector.observePlayback(0.05, 400)).toBe(false);
    expect(detector.observePlayback(0.05, 800)).toBe(false);
    expect(detector.observePlayback(0.05, 980)).toBe(true);
  });

  it("calculates RMS without retaining audio samples", () => {
    expect(calculateVoiceRms(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5);
    expect(calculateVoiceRms(new Float32Array())).toBe(0);
  });
});
