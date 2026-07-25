import { transcribeAudio } from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "../server-security.js";

const API_BUILD_ID = "2026-07-22-groq-transcription";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-Request-Id");
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  return req.body || {};
};

const getClientErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fetch failed")) {
    return "Network error: Could not reach the transcription service.";
  }

  if (message.includes("API key") || message.toLowerCase().includes("unauthorized")) {
    return "Speech transcription is temporarily unavailable. Please try again later.";
  }

  return message || "Speech transcription failed. Please try again.";
};

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  setCorsHeaders(res);
  res.setHeader?.("X-Bible-Nova-Api-Build", API_BUILD_ID);
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `transcribe:user:${userId}`, limit: 10 },
      { key: `transcribe:ip:${ip}`, limit: 20 },
    ]);
    const { audio, language } = getBody(req);
    assertStringLength(audio, 8 * 1024 * 1024, "Audio");
    if (language !== undefined && language !== null) {
      assertStringLength(language, 32, "Language");
    }
    const metadataPrefix = typeof audio === "string" ? audio.slice(0, 80) : "";
    const mimeType = metadataPrefix.match(/^data:([^;,]+)/)?.[1] || "unknown";
    const encodedAudio = typeof audio === "string" ? audio.split(",", 2)[1] || "" : "";
    const approximateBytes = Math.floor((encodedAudio.length * 3) / 4);
    console.info("Speech transcription started", {
      requestId: requestId || "server-generated",
      mimeType,
      approximateBytes,
    });
    const text = await transcribeAudio(audio, language);
    console.info("Speech transcription completed", {
      requestId: requestId || "server-generated",
      durationMs: Date.now() - startedAt,
    });
    res.status(200).json({ text });
  } catch (error) {
    console.error("Vercel API speech transcription error:", {
      requestId: requestId || "server-generated",
      durationMs: Date.now() - startedAt,
      message: error instanceof Error ? error.message : String(error),
    });
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
