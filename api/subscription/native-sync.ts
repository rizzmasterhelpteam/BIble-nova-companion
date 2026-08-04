import { getNativeSubscriptionClientErrorMessage, syncNativeSubscription } from "../../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { setApiCorsHeaders } from "../../server-cors.js";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, POST, OPTIONS", "Content-Type, Authorization")) return;
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0");
  res.setHeader?.("Pragma", "no-cache");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    if (req.method === "GET") {
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
      return;
    }

    await enforceRateLimits([
      { key: `subscription-sync:user:${userId}`, limit: 10 },
      { key: `subscription-sync:ip:${ip}`, limit: 20 },
    ]);
    const subscription = await syncNativeSubscription(req.headers.authorization, req.body || {});
    res.status(200).json({ subscription });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    const expectedClientOrBusinessOutcome = details.statusCode >= 400 && details.statusCode < 500;
    (expectedClientOrBusinessOutcome ? console.warn : console.error)(
      "Vercel API native subscription sync outcome:",
      {
        statusCode: details.statusCode,
        message: details.message,
      },
    );
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({
      error: req.method === "POST" && details.statusCode >= 500
        ? getNativeSubscriptionClientErrorMessage(error)
        : details.message,
    });
  }
}
