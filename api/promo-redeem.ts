import { getClientErrorMessage, redeemPromoCode } from "../server-api";
import { enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../server-security";

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
      { key: `promo:user:${userId}`, limit: 5 },
      { key: `promo:ip:${ip}`, limit: 10 },
    ]);
    const result = await redeemPromoCode(req.headers.authorization, req.body?.code || "");
    res.status(200).json(result);
  } catch (error) {
    console.error("Vercel API promo redemption error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode === 500 ? 400 : details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
