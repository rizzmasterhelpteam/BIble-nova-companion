const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

export default function handler(req: any, res: any) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  res.status(200).json({
    chatReady: Boolean((process.env.GROQ_API_KEY || process.env.GROK_API_KEY)?.trim()),
    modelsReady: Boolean(process.env.GROK_API_KEY?.trim()),
    prayerReady: Boolean(process.env.GEMINI_API_KEY?.trim()),
    speechReady: Boolean(process.env.GROQ_API_KEY?.trim()),
  });
}
