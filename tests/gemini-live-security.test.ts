import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  getGeminiLiveConnectConfig,
} from "../gemini-live-config";

const endpointSource = readFileSync(
  new URL("../api/voice/live-token.ts", import.meta.url),
  "utf8",
);

describe("Gemini Live security", () => {
  it("pins the preview model and v1beta API with audio-only output", () => {
    expect(GEMINI_LIVE_MODEL).toBe("gemini-3.1-flash-live-preview");
    expect(GEMINI_LIVE_API_VERSION).toBe("v1beta");
    expect(getGeminiLiveConnectConfig().responseModalities).toEqual(["AUDIO"]);
  });

  it("mints one-use constrained tokens only after auth, limits, and lease validation", () => {
    const auth = endpointSource.indexOf("requireAuthenticatedRequest(req)");
    const limits = endpointSource.indexOf("enforceRateLimits(");
    const lease = endpointSource.indexOf("getVoiceSessionAvailability(");
    const mint = endpointSource.indexOf("client.authTokens.create(");
    expect(auth).toBeGreaterThan(-1);
    expect(limits).toBeGreaterThan(auth);
    expect(lease).toBeGreaterThan(limits);
    expect(mint).toBeGreaterThan(lease);
    expect(endpointSource).toContain("uses: 1");
    expect(endpointSource).toContain("liveConnectConstraints");
    expect(endpointSource).toContain('availability.reason !== "reservation_resume"');
  });

  it("keeps tokens uncached and never logs token or transcript values", () => {
    expect(endpointSource).toContain('"Cache-Control", "private, no-store"');
    expect(endpointSource).not.toMatch(/console\.(?:info|error)\([^\n]*(?:token\.name|transcript|audioData)/i);
    expect(endpointSource).not.toContain("VITE_GEMINI_API_KEY");
  });
});
