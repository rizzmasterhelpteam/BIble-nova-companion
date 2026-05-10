export default async function handler(req: any, res: any) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey?.trim()) {
      res.status(500).json({ error: "GROK_API_KEY is missing." });
      return;
    }

    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}
