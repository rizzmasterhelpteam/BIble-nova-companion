import { createGeminiLiveEphemeralToken, getVoiceSessionConfig } from "../../live-api.js";
import {
  acquireVoiceSessionLease,
  enforceRateLimits,
  getHttpErrorDetails,
  getServerShadowNotes,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";

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
      { key: `live-token:user:${userId}`, limit: 6 },
      { key: `live-token:ip:${ip}`, limit: 12 },
    ]);

    const { maxMinutes } = getVoiceSessionConfig();
    const configuredDailyMinutes = Number(process.env.VOICE_DAILY_MAX_MINUTES || 60);
    const dailyMinutes = Number.isFinite(configuredDailyMinutes)
      ? Math.max(maxMinutes, Math.min(240, Math.floor(configuredDailyMinutes)))
      : 60;
    const leaseId = await acquireVoiceSessionLease(userId, maxMinutes, dailyMinutes);
    try {
      const shadowNotes = await getServerShadowNotes(userId);
      const session = await createGeminiLiveEphemeralToken(shadowNotes);
      res.status(200).json({ ...session, leaseId });
    } catch (error) {
      await releaseVoiceSessionLease(userId, leaseId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    console.error("Gemini Live token request failed:", error instanceof Error ? error.message : error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({
      error:
        details.statusCode === 500
          ? "Voice is temporarily unavailable. You can continue in Chat."
          : details.message,
    });
  }
}
