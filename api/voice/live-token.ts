import { createHash } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import {
  GEMINI_LIVE_API_VERSION,
  GEMINI_LIVE_MODEL,
  getGeminiLiveConnectConfig,
  hasGeminiLiveConfig,
} from "../../gemini-live-config.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getVoiceSessionAvailability,
  getVoiceUsageLimits,
  hashVoiceReservationHandle,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { getVoiceSessionConfig } from "../../voice-config.js";

const NEW_SESSION_WINDOW_MS = 60_000;
const TOKEN_EXPIRY_MARGIN_MS = 60_000;

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Client-Request-Id");
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    try { return req.body ? JSON.parse(req.body) : {}; } catch { return {}; }
  }
  return req.body || {};
};

const hashUserId = (userId: string) =>
  createHash("sha256").update(userId).digest("hex").slice(0, 12);

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  let userHash = "unverified";
  setCorsHeaders(res);
  res.setHeader?.("Cache-Control", "private, no-store");
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    userHash = hashUserId(userId);
    await enforceRateLimits([
      { key: `voice-live-token:user:${userId}`, limit: 12 },
      { key: `voice-live-token:ip:${ip}`, limit: 24 },
    ]);

    if (!hasGeminiLiveConfig()) {
      return res.status(503).json({ error: "Voice streaming is not configured." });
    }

    const handleHash = hashVoiceReservationHandle(getBody(req).reservationHandle);
    if (!handleHash) {
      return res.status(400).json({ error: "This Voice reservation is invalid." });
    }

    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, monthlyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
      monthlyMinutes,
      resetOffsetMinutes,
      handleHash,
    );

    if (!availability.eligible) {
      return res.status(403).json({
        error: "An active premium subscription is required for Voice mode.",
        reason: "subscription_required",
      });
    }
    if (
      availability.reason !== "reservation_resume" ||
      !availability.retryAfterSeconds ||
      availability.retryAfterSeconds < 10
    ) {
      return res.status(409).json({
        error: "This Voice reservation is no longer active.",
        reason: "reservation_invalid",
      });
    }

    const now = Date.now();
    const reservationExpiresAt = new Date(
      now + availability.retryAfterSeconds * 1_000,
    ).toISOString();
    const expiresAt = new Date(
      now + availability.retryAfterSeconds * 1_000 + TOKEN_EXPIRY_MARGIN_MS,
    ).toISOString();
    const newSessionExpiresAt = new Date(now + NEW_SESSION_WINDOW_MS).toISOString();
    const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!.trim() });
    const token = await client.authTokens.create({
      config: {
        httpOptions: { apiVersion: GEMINI_LIVE_API_VERSION },
        uses: 1,
        expireTime: expiresAt,
        newSessionExpireTime: newSessionExpiresAt,
        liveConnectConstraints: {
          model: GEMINI_LIVE_MODEL,
          config: getGeminiLiveConnectConfig(),
        },
      },
    });
    if (!token.name) throw new Error("Gemini returned an empty ephemeral token.");

    console.info("[voice/live-token] created", {
      requestId: requestId || "server-generated",
      userHash,
      reservationValidated: true,
      durationMs: Date.now() - startedAt,
    });
    return res.status(200).json({
      token: token.name,
      expiresAt,
      newSessionExpiresAt,
      reservationExpiresAt,
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    console.error("[voice/live-token] failed", {
      requestId: requestId || "server-generated",
      userHash,
      durationMs: Date.now() - startedAt,
      reason: details.message.slice(0, 160),
    });
    return res.status(details.statusCode === 500 ? 503 : details.statusCode).json({
      error: details.statusCode === 500
        ? "Voice streaming is temporarily unavailable."
        : details.message,
    });
  }
}
