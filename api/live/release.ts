import {
  getHttpErrorDetails,
  hashVoiceReservationHandle,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";

export default async function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  try {
    const { userId } = await requireAuthenticatedRequest(req);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const handleHash = hashVoiceReservationHandle(body.reservationHandle);
    if (!handleHash) {
      res.status(400).json({ error: "This Voice reservation is invalid." });
      return;
    }
    await releaseVoiceSessionLease(userId, handleHash);
    res.status(204).end();
  } catch (error) {
    const details = getHttpErrorDetails(error);
    res.status(details.statusCode).json({ error: details.message });
  }
}
