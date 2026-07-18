import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import { hasChatApiKey } from "./chat-api.js";
export {
  createChatCompletion,
  getClientErrorMessage,
  hasChatApiKey,
} from "./chat-api.js";

export const hasModelsApiKey = () => Boolean(process.env.GROK_API_KEY?.trim());

export const hasPrayerApiKey = () => Boolean(process.env.GEMINI_API_KEY?.trim());

export const hasSpeechApiKey = () => Boolean(process.env.GROQ_API_KEY?.trim());

export const hasNativeSubscriptionSyncConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const rawGoogleCredentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();

  if (!supabaseUrl || supabaseUrl.includes("placeholder.supabase.co") || !serviceRoleKey || !rawGoogleCredentials) {
    return false;
  }

  try {
    const credentials = JSON.parse(rawGoogleCredentials) as { client_email?: string; private_key?: string };
    return Boolean(credentials.client_email && credentials.private_key);
  } catch {
    return false;
  }
};

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
  nativeSubscriptionSyncReady: hasNativeSubscriptionSyncConfig(),
});

type UserSubscriptionMetadata = {
  status?: string;
  source?: string;
  trialEndsAt?: string;
  productId?: string;
  planId?: string;
  orderId?: string;
  linkedAt?: string;
  platform?: "android" | "ios";
};

type VerifiedGooglePlaySubscription = {
  productId: string;
  planId?: string;
  orderId?: string;
  expiryTime: string;
};

export type NativeSubscriptionSyncPayload = {
  productId?: string;
  planId?: string;
  orderId?: string;
  purchaseToken?: string;
  platform?: "android" | "ios";
};

const GOOGLE_PLAY_PACKAGE_NAME = "com.biblenovacompanion.app";
const GOOGLE_PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";

const getGooglePlayServiceAccount = () => {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    throw new Error("Google Play subscription verification is not configured on the server.");
  }

  try {
    const credentials = JSON.parse(raw) as { client_email?: string; private_key?: string };
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Missing client_email or private_key.");
    }
    return credentials;
  } catch {
    throw new Error("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is invalid.");
  }
};

const verifyGooglePlaySubscription = async (
  payload: NativeSubscriptionSyncPayload,
): Promise<VerifiedGooglePlaySubscription> => {
  const purchaseToken = normalizeOptionalString(payload.purchaseToken);
  const productId = normalizeOptionalString(payload.productId);
  if (!purchaseToken || !productId) {
    throw new Error("A Google Play purchase token and product ID are required for verification.");
  }

  const credentials = getGooglePlayServiceAccount();
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: [GOOGLE_PLAY_SCOPE],
  });
  const { token: accessToken } = await auth.getAccessToken();
  if (!accessToken) {
    throw new Error("Could not authenticate with Google Play for purchase verification.");
  }

  const endpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`;
  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await response.json().catch(() => ({}))) as {
    subscriptionState?: string;
    acknowledgementState?: string;
    lineItems?: Array<{
      productId?: string;
      expiryTime?: string;
      latestSuccessfulOrderId?: string;
      offerDetails?: { basePlanId?: string };
    }>;
  };

  if (!response.ok) {
    throw new Error("Google Play could not verify this purchase.");
  }

  const lineItem = data.lineItems?.find((item) => item.productId === productId);
  const expiryTime = lineItem?.expiryTime;
  const expiry = expiryTime ? Date.parse(expiryTime) : NaN;
  const allowedState =
    data.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" ||
    data.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";

  if (!lineItem || !expiryTime || !Number.isFinite(expiry) || expiry <= Date.now() || !allowedState) {
    throw new Error("This Google Play subscription is not active.");
  }

  if (data.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED") {
    throw new Error("This Google Play subscription has not been acknowledged.");
  }

  const verifiedOrderId = lineItem.latestSuccessfulOrderId;
  if (payload.orderId && verifiedOrderId && payload.orderId !== verifiedOrderId) {
    throw new Error("The purchase order does not match Google Play.");
  }

  const verifiedPlanId = lineItem.offerDetails?.basePlanId;
  if (payload.planId && verifiedPlanId && payload.planId !== verifiedPlanId) {
    throw new Error("The purchase plan does not match Google Play.");
  }

  return {
    productId,
    planId: verifiedPlanId,
    orderId: verifiedOrderId,
    expiryTime,
  };
};

const normalizeOptionalString = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
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

  const data = (await response.json().catch(() => ({}))) as {
    text?: string;
    error?: { message?: string };
  };
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

export async function syncNativeSubscription(
  authorizationHeader: string | undefined,
  payload: NativeSubscriptionSyncPayload,
) {
  const accessToken = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Missing active session. Please sign in again before restoring premium.");
  }

  const productId = normalizeOptionalString(payload.productId);
  const planId = normalizeOptionalString(payload.planId);
  const orderId = normalizeOptionalString(payload.orderId);
  const purchaseToken = normalizeOptionalString(payload.purchaseToken);
  const platform = payload.platform === "ios" ? "ios" : "android";

  if (!productId) {
    throw new Error("Native subscription sync requires a product ID.");
  }

  if (!purchaseToken) {
    throw new Error("Native subscription sync requires a purchase token.");
  }

  if (platform !== "android") {
    throw new Error("iOS subscription verification is not configured yet. Premium access was not granted.");
  }

  const verifiedPurchase = await verifyGooglePlaySubscription({
    ...payload,
    productId,
    planId,
    orderId,
    purchaseToken,
    platform,
  });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder.supabase.co")) {
    throw new Error("Supabase is not configured on the server.");
  }

  if (!serviceRoleKey) {
    throw new Error("Native subscription linking requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Could not verify the signed-in user. Please sign in again.");
  }

  const linkedAt = new Date().toISOString();
  const nextSubscription: UserSubscriptionMetadata = {
    status: "active",
    source: "native_google_play",
    productId: verifiedPurchase.productId,
    planId: verifiedPurchase.planId,
    orderId: verifiedPurchase.orderId,
    linkedAt,
    platform,
    trialEndsAt: verifiedPurchase.expiryTime,
  };

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const purchaseTokenHash = createHash("sha256").update(purchaseToken).digest("hex");
  const { data: entitlementLinked, error: entitlementError } = await adminClient.rpc(
    "link_subscription_entitlement",
    {
      p_user_id: data.user.id,
      p_platform: platform,
      p_product_id: verifiedPurchase.productId,
      p_base_plan_id: verifiedPurchase.planId || "",
      p_order_id: verifiedPurchase.orderId || "",
      p_purchase_token_hash: purchaseTokenHash,
      p_status: "active",
      p_expiry_time: verifiedPurchase.expiryTime,
      p_verified_at: linkedAt,
    },
  );

  if (entitlementError || entitlementLinked !== true) {
    throw new Error(entitlementError?.message || "Could not persist the verified subscription entitlement.");
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(data.user.id, {
    app_metadata: {
      ...(data.user.app_metadata || {}),
      subscription: nextSubscription,
    },
  });

  if (updateError) {
    throw new Error(updateError.message);
  }

  return nextSubscription;
}
