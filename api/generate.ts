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
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { prompt } = getBody(req);
    const { GoogleGenAI } = await import("@google/genai");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      throw new Error("Gemini API key is missing. Please configure it in settings.");
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Generate an uplifting, beautifully written 2-sentence prayer based on this prompt: ${prompt}`,
            },
          ],
        },
      ],
    });

    res.status(200).json({ text: response.text });
  } catch (error) {
    console.error("Vercel API generation error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
