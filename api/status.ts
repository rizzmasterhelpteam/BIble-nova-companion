import { getApiStatus } from "../server-api.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization, Cache-Control");
};

const setStatusHeaders = (res: any) => {
  res.setHeader?.("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader?.("Pragma", "no-cache");
  res.setHeader?.("Expires", "0");
};

export default function handler(req: any, res: any) {
  setCorsHeaders(res);
  setStatusHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  res.status(200).json(getApiStatus());
}
