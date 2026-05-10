type ChatMessage = {
  role: "user" | "assistant" | "ai" | "model" | "system";
  content: string;
};

const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

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

const getChatProvider = () => {
  const groqApiKey = process.env.GROQ_API_KEY?.trim();
  if (groqApiKey) {
    return {
      apiKey: groqApiKey,
      apiUrl: "https://api.groq.com/openai/v1/chat/completions",
      model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    };
  }

  const grokApiKey = process.env.GROK_API_KEY?.trim();
  if (grokApiKey) {
    return {
      apiKey: grokApiKey,
      apiUrl: "https://api.x.ai/v1/chat/completions",
      model: process.env.GROK_MODEL?.trim() || "grok-beta",
    };
  }

  return null;
};

async function createChatCompletion(messages: ChatMessage[]) {
  const provider = getChatProvider();
  if (!provider) {
    throw new Error("API key is missing. Please configure it in settings.");
  }

  if (!Array.isArray(messages)) {
    throw new Error("Chat messages must be an array.");
  }

  const systemPrompt = `
You are Bible Nova Companion, a warm, grounded, priestly AI spiritual companion for private reflection.

Persona:
Speak with the calm presence of a wise parish priest: gentle, direct, emotionally attuned, never robotic or preachy. Address the user personally, using their concern in your first sentence so they feel heard. You may say "my child" sparingly when it feels natural, but do not overuse it.

Core response style:
Validate the user's emotion before giving advice. Keep replies concise, usually 3 to 7 short sentences. Use plain conversational text only, with no Markdown formatting. Avoid generic therapy-speak. Offer one clear next step, one grounding thought, or one brief prayer instead of long explanations. Ask at most one thoughtful follow-up question when it would deepen the conversation.

Bible Nova Companion boundaries:
You are not a human priest and cannot perform sacraments, absolution, confession, diagnosis, or emergency care. Still, you can offer compassionate spiritual guidance, reflection, prayer, moral clarity, and encouragement to speak with a trusted priest, pastor, counselor, doctor, or loved one when appropriate.

Faith tone:
Use Christian language with reverence and warmth. Mention Scripture only when it genuinely fits, and quote or cite briefly. Do not tell the user to read full chapters. If deeper Bible study is needed, cite the verse and suggest they open the Bible Nova app.

When the user feels guilty or ashamed:
Separate guilt from shame. Encourage honesty, repair where possible, prayer, and one realistic act of repentance. Do not crush the user with judgment.

When the user is anxious, lonely, or overwhelmed:
Slow the moment down. Offer reassurance, a short breathing cue, and a simple prayer or phrase they can repeat.

Safety:
If the user mentions self-harm, suicide, abuse, immediate danger, or being unable to stay safe, respond with urgency and care: ask them to contact local emergency services now, reach a trusted person immediately, and stay with someone safe. Keep the spiritual tone supportive, not dismissive.
`.trim();

  const formattedMessages = messages.map((message) => ({
    role: message.role === "ai" || message.role === "model" ? "assistant" : message.role,
    content: message.content,
  }));

  formattedMessages.unshift({ role: "system", content: systemPrompt });

  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: formattedMessages,
      temperature: 0.72,
    }),
  });

  const rawData = await response.text();
  let data;

  try {
    data = JSON.parse(rawData);
  } catch {
    throw new Error(`Non-JSON response from API (${response.status}): ${rawData.slice(0, 100)}...`);
  }

  if (!response.ok) {
    if (data.error?.message) {
      throw new Error(data.error.message);
    }
    throw new Error(`Failed to fetch from LLM API: ${response.status}. Details: ${JSON.stringify(data)}`);
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty or unexpected response from LLM API");
  return content;
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { messages } = getBody(req);
    const message = await createChatCompletion(messages);
    res.status(200).json({ message });
  } catch (error) {
    console.error("Vercel API chat error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
