import { generatePrayer, getClientErrorMessage } from "../api";

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  return req.body || {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { prompt } = getBody(req);
    const text = await generatePrayer(prompt);
    res.status(200).json({ text });
  } catch (error) {
    console.error("Vercel API generation error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
