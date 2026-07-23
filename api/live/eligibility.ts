import {
  enforceRateLimits,
  getVoiceSessionAvailability,
  getVoiceUsageLimits,
  getHttpErrorDetails,
  hashVoiceReservationHandle,
  requireAuthenticatedRequest,
} from "../../server-security.js";
import { getVoiceSessionConfig } from "../../live-api.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Voice-Reservation");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `live-eligibility:user:${userId}`, limit: 20 },
      { key: `live-eligibility:ip:${ip}`, limit: 40 },
    ]);
    const reservationHeader = req.headers?.["x-voice-reservation"];
    const reservationHandle = Array.isArray(reservationHeader) ? reservationHeader[0] : reservationHeader;
    const handleHash = hashVoiceReservationHandle(reservationHandle);
    const { maxMinutes } = getVoiceSessionConfig();
    const { dailyMinutes, resetOffsetMinutes } = getVoiceUsageLimits(maxMinutes);
    const availability = await getVoiceSessionAvailability(
      userId,
      maxMinutes,
      dailyMinutes,
      resetOffsetMinutes,
      handleHash,
    );
    return res.status(200).json(availability);
  } catch (error) {
    const details = getHttpErrorDetails(error);
    return res.status(details.statusCode).json({
      error: details.statusCode === 500 ? "Voice eligibility could not be checked." : details.message,
    });
  }
}
