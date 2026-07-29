import {
  enforceRateLimits,
  getHttpErrorDetails,
  getSubscriptionAccessStatus,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Authorization");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0");
  res.setHeader?.("Pragma", "no-cache");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `subscription-status:user:${userId}`, limit: 60 },
      { key: `subscription-status:ip:${ip}`, limit: 120 },
    ]);
    const status = await getSubscriptionAccessStatus(userId);
    return res.status(200).json({
      active: status.active,
      expiresAt: status.expiresAt,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    return res.status(details.statusCode).json({ error: details.message });
  }
}
