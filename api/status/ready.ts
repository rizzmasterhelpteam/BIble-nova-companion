import { getApiStatus } from "../../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { setApiCorsHeaders } from "../../server-cors.js";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization, Cache-Control")) return;

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
      { key: `api-readiness:user:${userId}`, limit: 30 },
      { key: `api-readiness:ip:${ip}`, limit: 60 },
    ]);
    res.status(200).json(getApiStatus());
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.message });
  }
}
