import {
  getClientErrorMessage,
  MAX_SHADOW_NOTES_CHARS,
} from "../chat-api.js";
import {
  loadShadowMemoryProfile,
  saveShadowNotes,
  setShadowMemoryPreference,
} from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  HttpError,
  requireAuthenticatedRequest,
} from "../server-security.js";

const API_BUILD_ID = "2026-07-29-shadow-memory-consent";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control");
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0, must-revalidate");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("Expires", "0");
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
  res.setHeader?.("X-Bible-Nova-Api-Build", API_BUILD_ID);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (!["GET", "POST", "PUT"].includes(req.method)) {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    const isRead = req.method === "GET";
    await enforceRateLimits([
      { key: `shadow-notes:${req.method.toLowerCase()}:user:${userId}`, limit: isRead ? 60 : 20 },
      { key: `shadow-notes:${req.method.toLowerCase()}:ip:${ip}`, limit: isRead ? 120 : 40 },
    ]);

    if (req.method === "GET") {
      res.status(200).json(await loadShadowMemoryProfile(userId));
      return;
    }

    const body = getBody(req);
    if (req.method === "PUT") {
      if (typeof body.memoryEnabled !== "boolean") {
        throw new HttpError("Memory preference must be true or false.", 400);
      }
      res.status(200).json(await setShadowMemoryPreference(userId, body.memoryEnabled));
      return;
    }

    assertStringLength(body.notes, MAX_SHADOW_NOTES_CHARS, "Shadow notes");
    const profile = await loadShadowMemoryProfile(userId);
    if (!profile.memoryEnabled) {
      res.status(200).json({ memoryEnabled: false, shadowNotes: null });
      return;
    }

    const shadowNotes = await saveShadowNotes(userId, body.notes);
    if (!shadowNotes && body.notes.trim()) {
      res.status(200).json(await loadShadowMemoryProfile(userId));
      return;
    }
    res.status(200).json({ memoryEnabled: true, shadowNotes });
  } catch (error) {
    console.error("Vercel API shadow notes error:", error);
    const details = getHttpErrorDetails(error);
    const statusCode =
      details.statusCode === 500 && error instanceof Error && error.message === "Invalid JSON request body."
        ? 400
        : details.statusCode;
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(statusCode).json({ error: statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
