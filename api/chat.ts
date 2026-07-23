import { getClientErrorMessage } from "../chat-api.js";
import { getKjvScriptureContext } from "../kjv-context.js";
import { createReflectionResponse } from "../server-api.js";
import {
  assertStringLength,
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "../server-security.js";

const API_BUILD_ID = "2026-07-16-shared-chat-security";

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
  res.setHeader?.("X-Bible-Nova-Api-Build", API_BUILD_ID);

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
      { key: `chat:user:${userId}`, limit: 30 },
      { key: `chat:ip:${ip}`, limit: 60 },
    ]);

    const body = getBody(req);
    if (body.scriptureContextOnly === true) {
      const query = typeof body.query === "string" ? body.query.trim() : "";
      assertStringLength(query, 800, "Scripture query");
      res.status(200).json({ scriptureContext: getKjvScriptureContext(query) });
      return;
    }

    const { messages, shadowNotes } = body;
    if (shadowNotes !== undefined && shadowNotes !== null) {
      assertStringLength(shadowNotes, 2_000, "Shadow notes");
    }

    const result = await createReflectionResponse(userId, messages, shadowNotes);
    res.status(200).json(result);
  } catch (error) {
    console.error("Vercel API chat error:", error);
    const details = getHttpErrorDetails(error);
    const statusCode = details.statusCode === 500 && error instanceof Error && error.message === "Invalid JSON request body."
      ? 400
      : details.statusCode;
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(statusCode).json({ error: statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
