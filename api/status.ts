import { setApiCorsHeaders } from "../server-cors.js";

const setStatusHeaders = (res: any) => {
  res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("Expires", "0");
};

export default function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization, Cache-Control")) return;
  setStatusHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  // Keep public liveness intentionally non-sensitive. Provider readiness and
  // configuration details belong behind the authenticated readiness route.
  res.status(200).json({ ok: true });
}
