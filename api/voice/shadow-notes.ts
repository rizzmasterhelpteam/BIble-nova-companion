import { createShadowNotes, type ChatMessage } from "../../chat-api.js";
import { loadShadowMemoryProfile, saveShadowNotes } from "../../server-api.js";
import { assertStringLength, enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../../server-security.js";
import { setApiCorsHeaders } from "../../server-cors.js";

const normalizeMessages = (value: unknown): ChatMessage[] => {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-12)
    .map((message) => {
      if (!message || typeof message !== "object") return null;
      const role = "role" in message && message.role === "ai" ? "ai" : "user";
      const content = "content" in message && typeof message.content === "string"
        ? message.content.trim()
        : "";
      if (!content) return null;
      assertStringLength(content, 2_000, "Voice transcript");
      return { role, content } satisfies ChatMessage;
    })
    .filter((message): message is { role: "user" | "ai"; content: string } => Boolean(message));
};

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "POST, OPTIONS", "Content-Type, Authorization, X-Client-Request-Id")) return;
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");

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
      { key: `live-shadow-notes:user:${userId}`, limit: 10 },
      { key: `live-shadow-notes:ip:${ip}`, limit: 20 },
    ]);

    const memoryProfile = await loadShadowMemoryProfile(userId);
    if (!memoryProfile.memoryEnabled) {
      res.status(200).json({ memoryEnabled: false, shadowNotes: null });
      return;
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const messages = normalizeMessages(body.messages);
    const existingShadowNotes = memoryProfile.shadowNotes;

    if (!messages.length) {
      res.status(200).json({ memoryEnabled: true, shadowNotes: existingShadowNotes });
      return;
    }

    const generatedShadowNotes = await createShadowNotes(messages, existingShadowNotes || null);
    const shadowNotes = generatedShadowNotes
      ? await saveShadowNotes(userId, generatedShadowNotes)
      : null;
    if (generatedShadowNotes && !shadowNotes) {
      res.status(200).json(await loadShadowMemoryProfile(userId));
      return;
    }
    res.status(200).json({ memoryEnabled: true, shadowNotes });
  } catch (error) {
    console.error("Voice shadow-note request failed:", error instanceof Error ? error.message : error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({
      error:
        details.statusCode === 500
          ? "Voice notes could not be updated. Your conversation is still safe."
          : details.message,
    });
  }
}
