import { getVoiceSessionConfig } from "../../voice-config.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getVoiceSessionAvailability,
  getVoiceUsageLimits,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { setApiCorsHeaders } from "../../server-cors.js";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization")) return;
  res.setHeader?.("Cache-Control", "private, no-store, no-cache, max-age=0");
  res.setHeader?.("Pragma", "no-cache");

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
      { key: `voice-usage:user:${userId}`, limit: 60 },
      { key: `voice-usage:ip:${ip}`, limit: 120 },
    ]);

    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, monthlyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
      monthlyMinutes,
      resetOffsetMinutes,
      null,
    );

    res.status(200).json({
      eligible: availability.eligible,
      usage: availability.usage,
      limits: {
        maxSessionMinutes: maxMinutes,
        dailyMinutes,
        monthlyMinutes,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Vercel API Voice usage error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({
      error: details.statusCode === 500
        ? "Voice usage is temporarily unavailable."
        : details.message,
    });
  }
}
