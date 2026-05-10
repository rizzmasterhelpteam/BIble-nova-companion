const API_BUILD_ID = "2026-05-10-no-relative-imports";

export default function handler(req: any, res: any) {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.status(200).json({
    buildId: API_BUILD_ID,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
  });
}
