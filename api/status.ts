const setCorsHeaders = (res: any) => {
  res.setHeader?.("Access-Control-Allow-Origin", "*");
  res.setHeader?.("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader?.("Access-Control-Allow-Headers", "Content-Type, Authorization");
};

const hasServerKey = (name: string) => Boolean(process.env[name]?.trim());

const getApiStatus = () => ({
  chatReady: hasServerKey("GROQ_API_KEY") || hasServerKey("GROK_API_KEY"),
  modelsReady: hasServerKey("GROK_API_KEY"),
  prayerReady: hasServerKey("GEMINI_API_KEY"),
  speechReady: hasServerKey("GROQ_API_KEY"),
});

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

  res.status(200).json(getApiStatus());
}
