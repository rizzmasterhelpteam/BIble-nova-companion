import {
  acquireVoiceSessionLease,
  createVoiceReservationHandle,
  enforceRateLimits,
  getHttpErrorDetails,
  getVoiceSessionAvailability,
  getVoiceUsageLimits,
  hashVoiceReservationHandle,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { getVoiceSessionConfig } from "../../voice-config.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    try {
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      return {};
    }
  }
  return req.body || {};
};

const reasonForStatus = (statusCode: number, message: string) => {
  if (statusCode === 403) return "subscription_required";
  if (statusCode === 409) return "session_active";
  if (statusCode === 429 && message.toLowerCase().includes("daily")) return "daily_limit";
  return "connection_failed";
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `voice-session:user:${userId}`, limit: 20 },
      { key: `voice-session:ip:${ip}`, limit: 40 },
    ]);

    const body = getBody(req);
    const action = body.action === "release" ? "release" : "start";
    if (action === "release") {
      const handleHash = hashVoiceReservationHandle(body.reservationHandle);
      if (!handleHash) return res.status(400).json({ error: "This Voice reservation is invalid." });
      await releaseVoiceSessionLease(userId, handleHash);
      return res.status(204).end();
    }

    let reservationHandle =
      typeof body.reservationHandle === "string" ? body.reservationHandle : "";
    let handleHash = hashVoiceReservationHandle(reservationHandle);
    if (!handleHash) {
      const created = createVoiceReservationHandle();
      reservationHandle = created.handle;
      handleHash = created.handleHash;
    }

    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );

    if (availability.reason === "reservation_resume" && availability.retryAfterSeconds) {
      return res.status(200).json({
        reservationHandle,
        reservationExpiresAt: new Date(Date.now() + availability.retryAfterSeconds * 1_000).toISOString(),
        remainingSeconds: availability.retryAfterSeconds,
        resumed: true,
      });
    }
    if (!availability.eligible) {
      return res.status(403).json({
        error: "An active premium subscription is required for Voice mode.",
        reason: "subscription_required",
      });
    }
    if (!availability.available) {
      const status = availability.reason === "daily_limit" ? 429 : 409;
      if (availability.retryAfterSeconds) {
        res.setHeader?.("Retry-After", String(availability.retryAfterSeconds));
      }
      return res.status(status).json({
        error: availability.reason === "daily_limit"
          ? "Your daily Voice allowance has been reached."
          : "A Voice session is already active for this account.",
        reason: availability.reason,
        retryAfterSeconds: availability.retryAfterSeconds,
      });
    }

    const lease = await acquireVoiceSessionLease(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    return res.status(200).json({
      reservationHandle,
      reservationExpiresAt: lease.expiresAt,
      remainingSeconds: Math.max(0, Math.floor((Date.parse(lease.expiresAt) - Date.now()) / 1_000)),
      resumed: false,
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    return res.status(details.statusCode).json({
      error: details.statusCode === 500
        ? "Voice session protection is temporarily unavailable."
        : details.message,
      reason: reasonForStatus(details.statusCode, details.message),
    });
  }
}
