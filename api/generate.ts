import { generatePrayer } from "../server-api.js";
import { assertStringLength, enforceRateLimits, getHttpErrorDetails, requireAuthenticatedRequest } from "../server-security.js";

const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  return req.body || {};
};

const getClientErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fetch failed")) {
    return "Network error: Could not reach the LLM API.";
  }

  if (message.includes("API key") || message.toLowerCase().includes("unauthorized")) {
    return "Your API key is invalid or unauthorized. Please verify it in Settings/Secrets.";
  }

  return message || "Failed to generate response. Please try again.";
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
    const { userId, ip } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `generate:user:${userId}`, limit: 20 },
      { key: `generate:ip:${ip}`, limit: 40 },
    ]);
    const { prompt } = getBody(req);
    assertStringLength(prompt, 2_000, "Prompt");
    const text = await generatePrayer(prompt);
    res.status(200).json({ text });
  } catch (error) {
    console.error("Vercel API generation error:", error);
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) {
      res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    }
    res.status(details.statusCode).json({ error: details.statusCode === 500 ? getClientErrorMessage(error) : details.message });
  }
}
