import { getApiStatus } from "../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  requireAuthenticatedRequest,
} from "../server-security.js";
import { setApiCorsHeaders } from "../server-cors.js";

const setStatusHeaders = (res: any) => {
  res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("Expires", "0");
};

const getQueryValue = (req: any, key: string) => {
  const queryValue = req?.query?.[key];
  if (Array.isArray(queryValue)) return queryValue[0];
  if (typeof queryValue === "string") return queryValue;

  try {
    return new URL(req?.url || "", "https://biblecompanion.vercel.app")
      .searchParams
      .get(key) || undefined;
  } catch {
    return undefined;
  }
};

const isReadinessRequest = (req: any) => getQueryValue(req, "mode") === "ready";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization, Cache-Control")) return;
  setStatusHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  if (!isReadinessRequest(req)) {
    // Keep public liveness intentionally non-sensitive. Provider readiness and
    // configuration details belong behind the authenticated readiness mode.
    res.status(200).json({ ok: true });
    return;
  }

  try {
    const { userId } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `api-readiness:user:${userId}`, limit: 30 },
    ]);
    res.status(200).json(getApiStatus());
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.message });
  }
}
