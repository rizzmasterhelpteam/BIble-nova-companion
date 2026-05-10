export default function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  res.status(200).json({
    chatReady: Boolean((process.env.GROQ_API_KEY || process.env.GROK_API_KEY)?.trim()),
    modelsReady: Boolean(process.env.GROK_API_KEY?.trim()),
    prayerReady: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
}
