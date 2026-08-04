import { createHash } from "node:crypto";
import type { ChatMessage } from "../chat-api.js";
import {
  getClientErrorMessage,
  MAX_SHADOW_NOTES_CHARS,
} from "../chat-api.js";
import {
  createReflectionResponse,
  createVoiceReflectionResponse,
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

const API_BUILD_ID = "2026-07-29-fast-voice-respond";

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

const normalizeVoiceMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) throw new Error("Voice messages must be an array.");

  return value
    .slice(-24)
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const content =
        "content" in message && typeof message.content === "string"
          ? message.content.trim()
          : "";
      if (!content) return null;
      assertStringLength(content, 2_000, "Voice message");
      return {
        role: "role" in message && message.role === "ai" ? "ai" : "user",
        content,
      } satisfies ChatMessage;
    })
    .filter(
      (message): message is { role: "user" | "ai"; content: string } =>
        Boolean(message),
    );
};

const hashUserId = (userId: string) =>
  createHash("sha256").update(userId).digest("hex").slice(0, 12);

export default async function handler(req: any, res: any) {
  const requestId = String(req.headers?.["x-client-request-id"] || "").slice(0, 80);
  const startedAt = Date.now();
  const timings: Record<string, number | undefined> = {};
  const setTimingHeader = () => {
    timings.total = Date.now() - startedAt;
    res.setHeader?.("Server-Timing", formatServerTiming(timings));
  };
  let voiceMode = false;
  let userHash = "unverified";
  if (!setApiCorsHeaders(req, res, "POST, OPTIONS", "Content-Type, Authorization, X-Client-Request-Id")) return;
  res.setHeader?.("X-Bible-Nova-Api-Build", API_BUILD_ID);
  res.setHeader?.("Cache-Control", "private, no-store");
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
    const authStartedAt = Date.now();
    const { userId } = await requireAuthenticatedRequest(req);
    timings.auth = Date.now() - authStartedAt;
    userHash = hashUserId(userId);
    const body = getBody(req);
    const requestPath = String(req.url || "").split("?", 1)[0];
    voiceMode =
      body.mode === "voice" ||
      req.query?.mode === "voice" ||
      requestPath === "/api/voice/respond";
    const rateLimitStartedAt = Date.now();
    await enforceRateLimits([
      {
        key: `${voiceMode ? "voice-respond" : "chat"}:user:${userId}`,
        limit: voiceMode ? getVoiceRateLimit("VOICE_RESPOND_RATE_LIMIT") : 30,
      },
    ], voiceMode ? getVoiceRateLimitWindowMs() : undefined);
    timings["rate-limit"] = Date.now() - rateLimitStartedAt;

    const { messages, shadowNotes } = body;
    if (shadowNotes !== undefined && shadowNotes !== null) {
      assertStringLength(shadowNotes, MAX_SHADOW_NOTES_CHARS, "Shadow notes");
    }

    if (voiceMode) {
      const normalizedMessages = normalizeVoiceMessages(messages);
      if (!normalizedMessages.length) throw new Error("Voice messages are required.");
      const voiceLanguage = normalizeVoiceLanguage(body.voiceLanguage);
      console.info("[voice/respond] started", {
        requestId: requestId || "server-generated",
        userHash,
        messageCount: normalizedMessages.length,
        vercelRegion: process.env.VERCEL_REGION || null,
        supabaseRegion: process.env.SUPABASE_REGION || null,
      });
      const providerStartedAt = Date.now();
      const result = await createVoiceReflectionResponse(
        userId,
        normalizedMessages,
        typeof shadowNotes === "string" ? shadowNotes : null,
        voiceLanguage,
      );
      timings.provider = Date.now() - providerStartedAt;
      console.info("[voice/respond] completed", {
        requestId: requestId || "server-generated",
        userHash,
        durationMs: Date.now() - startedAt,
        providerStatus: 200,
        responseCharacters: result.message.length,
      });
      setTimingHeader();
      return res.status(200).json(result);
    }

    const providerStartedAt = Date.now();
    const result = await createReflectionResponse(userId, messages, shadowNotes);
    timings.provider = Date.now() - providerStartedAt;
    setTimingHeader();
    return res.status(200).json(result);
  } catch (error) {
    const details = getHttpErrorDetails(error);
    const invalidRequest =
      error instanceof Error &&
      (
        error.message === "Invalid JSON request body." ||
        error.message === "Voice messages must be an array." ||
        error.message === "Voice messages are required."
      );
    const statusCode = invalidRequest ? 400 : details.statusCode;
    if (voiceMode) {
      console.error("[voice/respond] failed", {
        requestId: requestId || "server-generated",
        userHash,
        durationMs: Date.now() - startedAt,
        providerStatus: statusCode,
        reason:
          error instanceof Error
            ? error.message.slice(0, 240)
            : String(error).slice(0, 240),
      });
    } else {
      console.error("Vercel API chat error:", error);
    }
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    setTimingHeader();
    return res.status(statusCode).json({
      error: statusCode === 500 ? getClientErrorMessage(error) : details.message,
    });
  }
}
