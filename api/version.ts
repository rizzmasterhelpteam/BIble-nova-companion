const API_BUILD_ID = "2026-05-10-no-relative-imports";

export default function handler(_req: any, res: any) {
  res.status(200).json({
    buildId: API_BUILD_ID,
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    ref: process.env.VERCEL_GIT_COMMIT_REF || null,
  });
}
