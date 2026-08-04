import { getSubscriptionAccessStatus, enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../../server-security.js";
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
      { key: `subscription-status:user:${userId}`, limit: 60 },
      { key: `subscription-status:ip:${ip}`, limit: 120 },
    ]);
    const status = await getSubscriptionAccessStatus(userId);
    res.status(200).json({
      state: status.state,
      active: status.active,
      status: status.status,
      source: status.source,
      productId: status.productId,
      expiresAt: status.expiresAt,
      verifiedAt: status.verifiedAt,
      reconciliationRecommended: status.reconciliationRecommended,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({ error: details.message });
  }
}
