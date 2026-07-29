export const BARGE_IN_MIN_SPEECH_MS = 180;
export const BARGE_IN_RMS_MULTIPLIER = 2.2;
export const BARGE_IN_ABSOLUTE_FLOOR = 0.028;
export const BARGE_IN_COOLDOWN_MS = 500;

type BargeInDetectorOptions = {
  minimumSpeechMs?: number;
  rmsMultiplier?: number;
  absoluteFloor?: number;
  cooldownMs?: number;
  initialNoiseFloor?: number;
  ambientSmoothing?: number;
};

export const calculateVoiceRms = (samples: Float32Array) => {
  if (!samples.length) return 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
};

export class AdaptiveBargeInDetector {
  private readonly minimumSpeechMs: number;
  private readonly rmsMultiplier: number;
  private readonly absoluteFloor: number;
  private readonly cooldownMs: number;
  private readonly ambientSmoothing: number;
  private noiseFloor: number;
  private candidateStartedAt: number | null = null;
  private cooldownUntil = 0;

  constructor(options: BargeInDetectorOptions = {}) {
    this.minimumSpeechMs = options.minimumSpeechMs ?? BARGE_IN_MIN_SPEECH_MS;
    this.rmsMultiplier = options.rmsMultiplier ?? BARGE_IN_RMS_MULTIPLIER;
    this.absoluteFloor = options.absoluteFloor ?? BARGE_IN_ABSOLUTE_FLOOR;
    this.cooldownMs = options.cooldownMs ?? BARGE_IN_COOLDOWN_MS;
    this.noiseFloor = options.initialNoiseFloor ?? 0.01;
    this.ambientSmoothing = options.ambientSmoothing ?? 0.08;
  }

  getNoiseFloor() {
    return this.noiseFloor;
  }

  getThreshold() {
    return Math.max(this.absoluteFloor, this.noiseFloor * this.rmsMultiplier);
  }

  observeAmbient(rms: number) {
    if (!Number.isFinite(rms) || rms < 0) return;
    const ambientCeiling = Math.max(this.absoluteFloor, this.noiseFloor * 1.6);
    if (rms > ambientCeiling) return;
    this.noiseFloor =
      this.noiseFloor * (1 - this.ambientSmoothing) +
      rms * this.ambientSmoothing;
  }

  observePlayback(rms: number, now = performance.now()) {
    if (!Number.isFinite(rms) || rms < this.getThreshold() || now < this.cooldownUntil) {
      this.candidateStartedAt = null;
      return false;
    }

    if (this.candidateStartedAt === null) {
      this.candidateStartedAt = now;
      return false;
    }

    if (now - this.candidateStartedAt < this.minimumSpeechMs) return false;

    this.candidateStartedAt = null;
    this.cooldownUntil = now + this.cooldownMs;
    return true;
  }

  resetCandidate() {
    this.candidateStartedAt = null;
  }
}
