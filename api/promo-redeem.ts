import { getClientErrorMessage, redeemPromoCode } from "../server-api";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

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
    const result = await redeemPromoCode(req.headers.authorization, req.body?.code || "");
    res.status(200).json(result);
  } catch (error) {
    console.error("Vercel API promo redemption error:", error);
    res.status(400).json({ error: getClientErrorMessage(error) });
  }
}
