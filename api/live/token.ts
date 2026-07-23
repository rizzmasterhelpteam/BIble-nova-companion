import {
  createGeminiLiveEphemeralToken,
  getVoiceSessionConfig,
  VoiceTokenTimingError,
} from "../../live-api.js";
import {
  acquireVoiceSessionLease,
  cancelUnstartedVoiceSessionLease,
  claimVoiceSessionRenewal,
  createVoiceReservationHandle,
  enforceRateLimits,
  getHttpErrorDetails,
  getServerShadowNotes,
  getVoiceUsageLimits,
  finalizeVoiceSessionRenewal,
  hashVoiceReservationHandle,
  rollbackVoiceSessionRenewal,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const getRemainingSeconds = (expiresAt: string) =>
  Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1_000));

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

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (body.reservationHandle !== undefined) {
      const handleHash = hashVoiceReservationHandle(body.reservationHandle);
      if (!handleHash) {
        res.status(400).json({
          error: "This Voice reservation is invalid.",
          reason: "reservation_invalid",
        });
        return;
      }

      const renewal = await claimVoiceSessionRenewal(userId, handleHash);
      try {
        const shadowNotes = await getServerShadowNotes(userId);
        const session = await createGeminiLiveEphemeralToken({
          shadowNotes,
          reservationExpiresAt: renewal.expiresAt,
        });
        await finalizeVoiceSessionRenewal(userId, renewal.claimHash);
        res.status(200).json({
          ...session,
          reservationHandle: body.reservationHandle,
          reservationExpiresAt: renewal.expiresAt,
          remainingSeconds: getRemainingSeconds(renewal.expiresAt),
        });
      } catch (error) {
        await rollbackVoiceSessionRenewal(userId, renewal.claimHash);
        throw error;
      }
      return;
    }

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
      const session = await createGeminiLiveEphemeralToken({
        shadowNotes,
        reservationExpiresAt: lease.expiresAt,
      });
      res.status(200).json({
        ...session,
        reservationHandle: handle,
        reservationExpiresAt: lease.expiresAt,
        remainingSeconds: getRemainingSeconds(lease.expiresAt),
      });
    } catch (error) {
      await cancelUnstartedVoiceSessionLease(userId, lease.leaseId);
      throw error;
    }
  } catch (error) {
    const tokenTimingError = error instanceof VoiceTokenTimingError ? error : null;
    const details = tokenTimingError
      ? {
          statusCode: tokenTimingError.statusCode,
          message: tokenTimingError.message,
          retryAfterSeconds: undefined,
        }
      : getHttpErrorDetails(error);
    if (details.statusCode >= 500) {
      console.error("Gemini Live token request failed:", error instanceof Error ? error.message : error);
    }
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({
      error:
        details.statusCode === 500
          ? "Voice is temporarily unavailable. You can continue in Chat."
          : details.message,
      reason:
        tokenTimingError
          ? tokenTimingError.reason
          : details.statusCode === 403
          ? "subscription_required"
          : details.statusCode === 409
            ? details.message.toLowerCase().includes("cannot be renewed")
              ? "renewal_unavailable"
              : "session_active"
            : details.statusCode === 429 && details.message.toLowerCase().includes("daily")
              ? "daily_limit"
              : "connection_failed",
    });
  }
}
