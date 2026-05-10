import { createClient } from "@supabase/supabase-js";

export type ChatMessage = {
  role: "user" | "assistant" | "ai" | "model" | "system";
  content: string;
};

export const DEFAULT_GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export const hasChatApiKey = () =>
  Boolean((process.env.GROQ_API_KEY || process.env.GROK_API_KEY)?.trim());

export const hasModelsApiKey = () => Boolean(process.env.GROK_API_KEY?.trim());

export const hasPrayerApiKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const getApiStatus = () => ({
  chatReady: hasChatApiKey(),
  modelsReady: hasModelsApiKey(),
  prayerReady: hasPrayerApiKey(),
});

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

export async function createChatCompletion(messages: ChatMessage[]) {
  const provider = getChatProvider();
  if (!provider) {
    throw new Error("API key is missing. Please configure it in settings.");
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

export function getClientErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fetch failed")) {
    return "Network error: Could not reach the LLM API.";
  }

  if (message.includes("API key") || message.toLowerCase().includes("unauthorized")) {
    return "Your API key is invalid or unauthorized. Please verify it in Settings/Secrets.";
  }

  return message || "Failed to generate response. Please try again.";
}

export async function generatePrayer(prompt: string) {
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

  return response.text;
}

export async function deleteSupabaseAccount(authorizationHeader?: string) {
  const accessToken = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Missing active session. Please sign in again before deleting the account.");
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder.supabase.co")) {
    throw new Error("Supabase is not configured on the server.");
  }

  if (!serviceRoleKey) {
    throw new Error("Account deletion requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Could not verify the signed-in user. Please sign in again.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(data.user.id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return data.user.id;
}
