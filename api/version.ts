import { setApiCorsHeaders } from "../server-cors.js";

const API_BUILD_ID = "2026-07-16-v1.1.4-production-hardening";

export default function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization")) return;

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  res.status(200).json({
    buildId: API_BUILD_ID,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
  });
}
