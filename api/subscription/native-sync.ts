import { getClientErrorMessage, syncNativeSubscription } from "../../server-api";
import { enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../../server-security";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);

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
      { key: `subscription-sync:user:${userId}`, limit: 10 },
      { key: `subscription-sync:ip:${ip}`, limit: 20 },
    ]);
    const subscription = await syncNativeSubscription(req.headers.authorization, req.body || {});
    res.status(200).json({ subscription });
  } catch (error) {
    console.error("Vercel API native subscription sync error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode === 500 ? 400 : details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
