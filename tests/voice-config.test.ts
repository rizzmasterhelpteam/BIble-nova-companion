import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS,
  getVoiceSessionConfig,
} from "../voice-config";

const originalIdleTimeout = process.env.VOICE_IDLE_TIMEOUT_SECONDS;

afterEach(() => {
  if (originalIdleTimeout === undefined) delete process.env.VOICE_IDLE_TIMEOUT_SECONDS;
  else process.env.VOICE_IDLE_TIMEOUT_SECONDS = originalIdleTimeout;
});

describe("Voice session configuration", () => {
  it("uses a bounded server-supplied idle timeout", () => {
    process.env.VOICE_IDLE_TIMEOUT_SECONDS = "45";
    expect(getVoiceSessionConfig().idleTimeoutSeconds).toBe(45);

    process.env.VOICE_IDLE_TIMEOUT_SECONDS = "5";
    expect(getVoiceSessionConfig().idleTimeoutSeconds).toBe(
      DEFAULT_VOICE_IDLE_TIMEOUT_SECONDS,
    );
  });
});
