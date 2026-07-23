import { createGeminiLiveEphemeralToken, getVoiceSessionConfig } from "../../live-api.js";
import {
  acquireVoiceSessionLease,
  cancelUnstartedVoiceSessionLease,
  createVoiceReservationHandle,
  enforceRateLimits,
  getHttpErrorDetails,
  getServerShadowNotes,
  getVoiceUsageLimits,
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
    const { dailyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const { handle, handleHash } = createVoiceReservationHandle();
    const lease = await acquireVoiceSessionLease(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    try {
      const shadowNotes = await getServerShadowNotes(userId);
      const session = await createGeminiLiveEphemeralToken(shadowNotes);
      res.status(200).json({
        ...session,
        reservationHandle: handle,
        reservationExpiresAt: lease.expiresAt,
      });
    } catch (error) {
      await cancelUnstartedVoiceSessionLease(userId, lease.leaseId);
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
      reason:
        details.statusCode === 403
          ? "subscription_required"
          : details.statusCode === 409
            ? "session_active"
            : details.statusCode === 429 && details.message.toLowerCase().includes("daily")
              ? "daily_limit"
              : "connection_failed",
    });
  }
}
