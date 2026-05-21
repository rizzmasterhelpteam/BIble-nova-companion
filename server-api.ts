import { createClient } from "@supabase/supabase-js";
import { hasChatApiKey } from "./chat-api";
export {
  createChatCompletion,
  getClientErrorMessage,
  hasChatApiKey,
} from "./chat-api";

export const hasModelsApiKey = () => Boolean(process.env.GROK_API_KEY?.trim());

export const hasPrayerApiKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const hasSpeechApiKey = () => Boolean(process.env.GROQ_API_KEY?.trim());

export async function fetchAvailableModels() {
  const apiKey = process.env.GROK_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GROK_API_KEY is missing.");
  }

  const response = await fetch("https://api.x.ai/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      typeof data?.error === "string"
        ? data.error
        : typeof data?.error?.message === "string"
          ? data.error.message
          : `Could not load models (${response.status}).`,
    );
  }

  return data;
}

export const getApiStatus = () => ({
  chatReady: hasChatApiKey(),
  modelsReady: hasModelsApiKey(),
  prayerReady: hasPrayerApiKey(),
  speechReady: hasSpeechApiKey(),
});

type UserSubscriptionMetadata = {
  status?: string;
  source?: string;
  promoCode?: string;
  trialEndsAt?: string;
  redeemedAt?: string;
  durationDays?: number;
};

const PRIMARY_PROMO_CODE = (process.env.PROMO_CODE_PRIMARY || "GETNOW").trim().toUpperCase();
const PRIMARY_PROMO_CODE_DAYS = Math.max(1, Number(process.env.PROMO_CODE_PRIMARY_DAYS || 15));

const isActiveSubscriptionMetadata = (subscription: UserSubscriptionMetadata | undefined) => {
  if (!subscription || subscription.status !== "active") return false;
  if (!subscription.trialEndsAt) return true;
  const expiry = Date.parse(subscription.trialEndsAt);
  return Number.isFinite(expiry) && expiry > Date.now();
};

const parseBase64Audio = (audio: string) => {
  const match = audio.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error("Audio must be provided as a base64 data URL.");
  }

  const [, mimeType, base64] = match;
  return {
    mimeType,
    buffer: Buffer.from(base64, "base64"),
  };
};

export async function transcribeAudio(audio: string, language?: string) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Speech transcription requires GROQ_API_KEY on the server.");
  }

  const { mimeType, buffer } = parseBase64Audio(audio);
  const extension = mimeType.split("/")[1]?.split(";")[0] || "webm";
  const formData = new FormData();
  formData.append("file", new Blob([buffer], { type: mimeType }), `speech.${extension}`);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");
  formData.append("temperature", "0");

  if (language) {
    formData.append("language", language);
  }

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  const data = (await response.json().catch(() => ({}))) as { text?: string; error?: { message?: string } };
  if (!response.ok) {
    throw new Error(data.error?.message || "Speech transcription failed.");
  }

  if (!data.text?.trim()) {
    throw new Error("Speech transcription returned no text.");
  }

  return data.text.trim();
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

export async function redeemPromoCode(authorizationHeader: string | undefined, rawCode: string) {
  const accessToken = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Missing active session. Please sign in again before redeeming a promo code.");
  }

  const code = rawCode.trim().toUpperCase();
  if (!code) {
    throw new Error("Enter a promo code.");
  }

  if (code !== PRIMARY_PROMO_CODE) {
    throw new Error("That promo code is invalid.");
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder.supabase.co")) {
    throw new Error("Supabase is not configured on the server.");
  }

  if (!serviceRoleKey) {
    throw new Error("Promo redemption requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Could not verify the signed-in user. Please sign in again.");
  }

  const existingSubscription = (data.user.app_metadata?.subscription || undefined) as UserSubscriptionMetadata | undefined;
  if (
    existingSubscription?.source === "promo_code" &&
    existingSubscription?.promoCode === code &&
    isActiveSubscriptionMetadata(existingSubscription)
  ) {
    return {
      code,
      durationDays: existingSubscription.durationDays || PRIMARY_PROMO_CODE_DAYS,
      trialEndsAt: existingSubscription.trialEndsAt,
      alreadyRedeemed: true,
    };
  }

  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + PRIMARY_PROMO_CODE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nextSubscription: UserSubscriptionMetadata = {
    status: "active",
    source: "promo_code",
    promoCode: code,
    redeemedAt: now.toISOString(),
    trialEndsAt,
    durationDays: PRIMARY_PROMO_CODE_DAYS,
  };

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: updateError } = await adminClient.auth.admin.updateUserById(data.user.id, {
    app_metadata: {
      ...(data.user.app_metadata || {}),
      subscription: nextSubscription,
    },
  });

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    code,
    durationDays: PRIMARY_PROMO_CODE_DAYS,
    trialEndsAt,
    alreadyRedeemed: false,
  };
}
