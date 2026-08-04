import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS,
  DEFAULT_VOICE_SESSION_MAX_MINUTES,
  getVoiceSessionConfig,
} from "../voice-config";

const originalIdleTimeout = process.env.VOICE_IDLE_TIMEOUT_SECONDS;
const originalSessionMax = process.env.VOICE_SESSION_MAX_MINUTES;

afterEach(() => {
  if (originalIdleTimeout === undefined) delete process.env.VOICE_IDLE_TIMEOUT_SECONDS;
  else process.env.VOICE_IDLE_TIMEOUT_SECONDS = originalIdleTimeout;
  if (originalSessionMax === undefined) delete process.env.VOICE_SESSION_MAX_MINUTES;
  else process.env.VOICE_SESSION_MAX_MINUTES = originalSessionMax;
});

describe("Voice session configuration", () => {
  it("defaults the session limit to 30 minutes", () => {
    process.env.VOICE_SESSION_MAX_MINUTES = "invalid";
    expect(getVoiceSessionConfig().maxMinutes).toBe(
      DEFAULT_VOICE_SESSION_MAX_MINUTES,
    );
    expect(DEFAULT_VOICE_SESSION_MAX_MINUTES).toBe(30);

    process.env.VOICE_SESSION_MAX_MINUTES = "15";
    expect(getVoiceSessionConfig().maxMinutes).toBe(30);
  });

  it("uses a bounded server-supplied idle timeout", () => {
    process.env.VOICE_IDLE_TIMEOUT_SECONDS = "45";
    expect(getVoiceSessionConfig().idleTimeoutSeconds).toBe(45);

    process.env.VOICE_IDLE_TIMEOUT_SECONDS = "5";
    expect(getVoiceSessionConfig().idleTimeoutSeconds).toBe(
      DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS,
    );
  });
});
