import { describe, expect, it } from "vitest";
import {
  AdaptiveBargeInDetector,
  calculateVoiceRms,
} from "../src/lib/voiceBargeIn";

describe("adaptive Voice barge-in detector", () => {
  it("accepts a short intentional interruption while rejecting clicks and room noise", () => {
    const detector = new AdaptiveBargeInDetector({
      initialNoiseFloor: 0.01,
    });

    detector.observeAmbient(0.009);
    expect(detector.observePlayback(0.04, 0)).toBe(false);
    expect(detector.observePlayback(0.01, 40)).toBe(false);
    expect(detector.observePlayback(0.04, 100)).toBe(false);
    expect(detector.observePlayback(0.04, 219)).toBe(false);
    expect(detector.observePlayback(0.04, 220)).toBe(true);
  });

  it("learns a short playback echo baseline before accepting a barge-in", () => {
    const detector = new AdaptiveBargeInDetector({ initialNoiseFloor: 0.01 });

    detector.beginPlayback(0);
    expect(detector.observePlayback(0.05, 0)).toBe(false);
    expect(detector.observePlayback(0.05, 150)).toBe(false);
    expect(detector.observePlayback(0.05, 349)).toBe(false);
    expect(detector.observePlayback(0.05, 360)).toBe(false);
    expect(detector.observePlayback(0.12, 400)).toBe(false);
    expect(detector.observePlayback(0.12, 520)).toBe(true);
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
