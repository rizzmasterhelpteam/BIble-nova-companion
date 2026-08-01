import { fetchAvailableModels, getClientErrorMessage } from "../server-api.js";
import { setApiCorsHeaders } from "../server-cors.js";
import { enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../server-security.js";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization")) return;
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `models:user:${userId}`, limit: 10 },
      { key: `models:ip:${ip}`, limit: 20 },
    ]);
    const data = await fetchAvailableModels();
    res.status(200).json(data);
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({
      error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message,
    });
  }
}
