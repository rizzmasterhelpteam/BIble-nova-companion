const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const TTS_VOICE = "Gacrux";

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

const pcmToWav = (pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) => {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
};

const buildVoicePrompt = (text: string) =>
  [
    "Read the following transcript exactly as written.",
    "Voice direction: calm, deep, warm, fatherly, reassuring, grounded, mature, attractive, and never theatrical.",
    "Use measured pacing and gentle authority.",
    "",
    "Transcript:",
    text,
  ].join("\n");

async function generateSpeechAudioDataUrl(text: string) {
  const { GoogleGenAI } = await import("@google/genai");
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Voice playback requires GEMINI_API_KEY on the server.");
  }

  const cleanedText = text.trim();
  if (!cleanedText) {
    throw new Error("Text is required for voice playback.");
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: "user", parts: [{ text: buildVoicePrompt(cleanedText) }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: TTS_VOICE,
          },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error("Voice generation returned no audio.");
  }

  const pcmBuffer = Buffer.from(base64Audio, "base64");
  const wavBuffer = pcmToWav(pcmBuffer);
  return `data:audio/wav;base64,${wavBuffer.toString("base64")}`;
}

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
    const { text } = getBody(req);
    const audio = await generateSpeechAudioDataUrl(String(text || ""));
    res.status(200).json({ audio, voice: TTS_VOICE });
  } catch (error) {
    console.error("Vercel API speech generation error:", error);
    const message = error instanceof Error ? error.message : "Voice generation failed.";
    res.status(500).json({ error: message });
  }
}
