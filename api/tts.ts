import { createHash } from "node:crypto";
import {
  getGoogleTtsOptionsForVoiceLanguage,
  synthesizeSpeech,
} from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  formatServerTiming,
  getHttpErrorDetails,
  getVoiceRateLimit,
  getVoiceRateLimitWindowMs,
  requireAuthenticatedRequest,
} from "../server-security.js";
import { normalizeVoiceLanguage } from "../src/lib/voiceLanguage.js";
import { setApiCorsHeaders } from "../server-cors.js";

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    try {
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      throw new Error("Invalid JSON request body.");
    }
  }
  return req.body || {};
};

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  const timings: Record<string, number | undefined> = {};
  const setTimingHeader = () => {
    timings.total = Date.now() - startedAt;
    res.setHeader?.("Server-Timing", formatServerTiming(timings));
  };
  if (!setApiCorsHeaders(req, res, "POST, OPTIONS", "Content-Type, Authorization, X-Client-Request-Id")) return;
  res.setHeader?.("Cache-Control", "private, no-store");
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let userHash = "unverified";
  try {
    const authStartedAt = Date.now();
    const { userId } = await requireAuthenticatedRequest(req);
    timings.auth = Date.now() - authStartedAt;
    userHash = createHash("sha256").update(userId).digest("hex").slice(0, 12);
    const rateLimitStartedAt = Date.now();
    await enforceRateLimits([
      { key: `tts:user:${userId}`, limit: getVoiceRateLimit("VOICE_TTS_RATE_LIMIT") },
    ], getVoiceRateLimitWindowMs());
    timings["rate-limit"] = Date.now() - rateLimitStartedAt;
    const { text, voiceLanguage: requestedVoiceLanguage } = getBody(req);
    assertStringLength(text, 5_000, "Speech text");
    const voiceLanguage = normalizeVoiceLanguage(requestedVoiceLanguage);
    const providerStartedAt = Date.now();
    const audio = await synthesizeSpeech(
      text,
      getGoogleTtsOptionsForVoiceLanguage(voiceLanguage),
    );
    timings["tts-auth"] = audio.authMs;
    timings.provider = audio.providerMs ?? Date.now() - providerStartedAt;
    console.info("[voice/tts] completed", {
      requestId: requestId || "server-generated",
      userHash,
      durationMs: Date.now() - startedAt,
      providerStatus: 200,
      voiceName: audio.voiceName,
      languageCode: audio.languageCode,
      speakingRate: audio.speakingRate,
      pitch: audio.pitch,
      synthesisMode: audio.synthesisMode,
      characterCount: audio.characterCount,
      endpoint: audio.endpoint,
      vercelRegion: process.env.VERCEL_REGION || null,
    });

    const accept = String(req.headers?.accept || "");
    if (accept.toLowerCase().includes("audio/mpeg")) {
      const buffer = Buffer.from(audio.audioContent, "base64");
      res.setHeader?.("Content-Type", audio.mimeType || "audio/mpeg");
      res.setHeader?.("Content-Length", String(buffer.byteLength));
      setTimingHeader();
      return res.status(200).send(buffer);
    }
    const { authMs: _authMs, providerMs: _providerMs, endpoint: _endpoint, ...publicAudio } = audio;
    setTimingHeader();
    return res.status(200).json(publicAudio);
  } catch (error) {
    console.error("[voice/tts] failed", {
      requestId: requestId || "server-generated",
      userHash,
      durationMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    setTimingHeader();
    res.status(details.statusCode).json({
      error: details.statusCode === 500
        ? "The voice response could not be generated. The reply is still saved in Chat."
        : details.message,
    });
  }
}
