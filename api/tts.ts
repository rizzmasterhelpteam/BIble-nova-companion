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
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
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
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `tts:user:${userId}`, limit: 30 },
      { key: `tts:ip:${ip}`, limit: 60 },
    ]);
    const { text } = getBody(req);
    assertStringLength(text, 5_000, "Speech text");
    const audio = await synthesizeSpeech(text);
    res.status(200).json(audio);
  } catch (error) {
    console.error("Vercel API Text-to-Speech error:", error instanceof Error ? error.message : error);
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
