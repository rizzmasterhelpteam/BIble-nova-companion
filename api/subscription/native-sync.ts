import { getNativeSubscriptionClientErrorMessage, syncNativeSubscription } from "../../server-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
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
        active: status.active,
        expiresAt: status.expiresAt,
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
    console.error("Vercel API native subscription sync error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode === 500 ? 400 : details.statusCode).json({
      error: details.statusCode === 500 ? getNativeSubscriptionClientErrorMessage(error) : details.message,
    });
  }
}
