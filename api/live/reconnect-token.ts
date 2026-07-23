import { createGeminiLiveEphemeralToken } from "../../live-api.js";
import {
  enforceRateLimits,
  getHttpErrorDetails,
  getServerShadowNotes,
  hashVoiceReservationHandle,
  renewVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `live-reconnect:user:${userId}`, limit: 4 },
      { key: `live-reconnect:ip:${ip}`, limit: 8 },
    ]);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const handleHash = hashVoiceReservationHandle(body.reservationHandle);
    if (!handleHash) {
      return res.status(400).json({
        error: "This Voice reservation is invalid.",
        reason: "reservation_invalid",
      });
    }

    const lease = await renewVoiceSessionLease(userId, handleHash);
    const shadowNotes = await getServerShadowNotes(userId);
    const session = await createGeminiLiveEphemeralToken(shadowNotes);
    return res.status(200).json({
      ...session,
      reservationHandle: body.reservationHandle,
      reservationExpiresAt: lease.expiresAt,
    });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    return res.status(details.statusCode).json({
      error: details.statusCode === 409
        ? "This Voice reservation cannot reconnect again."
        : details.statusCode === 500
          ? "Voice reconnection is temporarily unavailable."
          : details.message,
      reason: details.statusCode === 409 ? "renewal_unavailable" : "reconnect_failed",
    });
  }
}
