import {
  enforceRateLimits,
  getHttpErrorDetails,
  releaseVoiceSessionLease,
  requireAuthenticatedRequest,
} from "../../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "DELETE, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default async function handler(req: any, res: any) {
  setCorsHeaders(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "DELETE") return res.status(405).json({ error: "Method not allowed." });

  try {
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `live-release:user:${userId}`, limit: 20 },
      { key: `live-release:ip:${ip}`, limit: 40 },
    ]);
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (typeof body.leaseId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.leaseId)) {
      return res.status(400).json({ error: "Invalid Voice session." });
    }
    await releaseVoiceSessionLease(userId, body.leaseId);
    return res.status(204).end();
  } catch (error) {
    const details = getHttpErrorDetails(error);
    return res.status(details.statusCode).json({
      error: details.statusCode === 500 ? "Voice session could not be released." : details.message,
    });
  }
}
