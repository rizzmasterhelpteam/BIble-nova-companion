import { fetchAvailableModels, getClientErrorMessage } from "../server-api.js";
import { setApiCorsHeaders } from "../server-cors.js";

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "GET, OPTIONS", "Content-Type, Authorization")) return;

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const data = await fetchAvailableModels();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
