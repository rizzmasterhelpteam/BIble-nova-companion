import { createHash } from "node:crypto";
import { synthesizeSpeech } from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Client-Request-Id",
  );
};

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
  setCorsHeaders(res);
  res.setHeader?.("Cache-Control", "private, no-store");
  if (requestId) res.setHeader?.("X-Client-Request-Id", requestId);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  let userHash = "unverified";
  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    userHash = createHash("sha256").update(userId).digest("hex").slice(0, 12);
    await enforceRateLimits([
      { key: `tts:user:${userId}`, limit: 30 },
      { key: `tts:ip:${ip}`, limit: 60 },
    ]);
    const { text } = getBody(req);
    assertStringLength(text, 5_000, "Speech text");
    const audio = await synthesizeSpeech(text);
    console.info("[voice/tts] completed", {
      requestId: requestId || "server-generated",
      userHash,
      durationMs: Date.now() - startedAt,
      providerStatus: 200,
      voiceName: audio.voiceName,
    });

    const accept = String(req.headers?.accept || "");
    if (accept.toLowerCase().includes("audio/mpeg")) {
      const buffer = Buffer.from(audio.audioContent, "base64");
      res.setHeader?.("Content-Type", audio.mimeType || "audio/mpeg");
      res.setHeader?.("Content-Length", String(buffer.byteLength));
      return res.status(200).send(buffer);
    }
    return res.status(200).json(audio);
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
    res.status(details.statusCode).json({
      error: details.statusCode === 500
        ? "The voice response could not be generated. The reply is still saved in Chat."
        : details.message,
    });
  }
}
