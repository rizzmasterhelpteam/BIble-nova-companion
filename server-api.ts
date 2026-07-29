import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { JWT } from "google-auth-library";
import {
  createChatCompletion,
  createReflection,
  createVoiceResponse,
  hasChatApiKey,
} from "./chat-api.js";
import {
  normalizeShadowNotes,
} from "./src/lib/shadowMemory";
import {
  getVoiceAudioFilename,
  isSupportedVoiceAudioMimeType,
  MAX_VOICE_AUDIO_BYTES,
  normalizeVoiceAudioMimeType,
} from "./src/lib/voiceTranscription.js";
import {
  getWhisperVocabularyPrompt,
  normalizeVoiceLanguage,
  type VoiceLanguage,
} from "./src/lib/voiceLanguage.js";
import {
  createGoogleTtsSsml,
  isGoogleTtsSsmlEnabled,
  normalizeVoiceSpeech,
  parseGoogleTtsPitch,
  parseGoogleTtsSpeakingRate,
} from "./src/lib/voiceSpeechFormatter.js";
export {
  createReflection,
  getClientErrorMessage,
  hasChatApiKey,
} from "./chat-api.js";

export const hasModelsApiKey = () => Boolean(process.env.GROK_API_KEY?.trim());

export const hasPrayerApiKey = () => Boolean(process.env.GROQ_API_KEY?.trim());

export const hasSpeechApiKey = () => Boolean(process.env.GROQ_API_KEY?.trim());

type TextToSpeechCredentials = {
  client_email: string;
  private_key: string;
};

let cachedTextToSpeechRaw: string | null = null;
let cachedTextToSpeechCredentials: TextToSpeechCredentials | null = null;
let cachedTextToSpeechAuth: JWT | null = null;

const getTextToSpeechServiceAccount = (throwOnMissing = true) => {
  const raw = process.env.GOOGLE_TTS_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    if (throwOnMissing) {
      throw new Error("Google Cloud Text-to-Speech is not configured on the server.");
    }
    return null;
  }

  try {
    if (cachedTextToSpeechRaw === raw && cachedTextToSpeechCredentials) {
      return cachedTextToSpeechCredentials;
    }

    const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
    const credentials = {
      client_email: parsed.client_email?.trim() || "",
      private_key: parsed.private_key?.replace(/\\n/g, "\n").trim() || "",
    };
    if (!credentials.client_email || !credentials.private_key) {
      throw new Error("Missing client_email or private_key.");
    }
    cachedTextToSpeechRaw = raw;
    cachedTextToSpeechCredentials = credentials;
    cachedTextToSpeechAuth = null;
    return credentials;
  } catch {
    if (throwOnMissing) {
      throw new Error("GOOGLE_TTS_SERVICE_ACCOUNT_JSON is invalid.");
    }
    return null;
  }
};

export const hasTextToSpeechConfig = () => Boolean(getTextToSpeechServiceAccount(false));

const getTextToSpeechAuthClient = () => {
  const credentials = getTextToSpeechServiceAccount();
  if (!cachedTextToSpeechAuth) {
    cachedTextToSpeechAuth = new JWT({
      email: credentials!.client_email,
      key: credentials!.private_key,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
  return cachedTextToSpeechAuth;
};

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
  ttsReady: hasTextToSpeechConfig(),
  voiceReady: hasChatApiKey() && hasSpeechApiKey() && hasTextToSpeechConfig(),
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

type GooglePlayErrorResponse = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
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
const SHADOW_NOTES_TABLE = "user_shadow_notes";
let cachedSupabaseAdminConfigKey: string | null = null;
let cachedSupabaseAdminClient: SupabaseClient<any, "public", "public", any, any> | null = null;

const getSupabaseServerConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || supabaseUrl.includes("placeholder.supabase.co") || !serviceRoleKey) {
    return null;
  }

  return { supabaseUrl, serviceRoleKey };
};

const createSupabaseAdminClient = () => {
  const config = getSupabaseServerConfig();
  if (!config) {
    return null;
  }

  const configKey = `${config.supabaseUrl}|${config.serviceRoleKey}`;
  if (
    cachedSupabaseAdminClient &&
    cachedSupabaseAdminConfigKey === configKey
  ) {
    return cachedSupabaseAdminClient;
  }

  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  cachedSupabaseAdminConfigKey = configKey;
  cachedSupabaseAdminClient = client;
  return client;
};

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
  } & GooglePlayErrorResponse;

  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason;
    console.error("Google Play subscription verification rejected:", {
      httpStatus: response.status,
      apiStatus: data.error?.status,
      reason,
      message: data.error?.message?.slice(0, 240),
      packageName: GOOGLE_PLAY_PACKAGE_NAME,
      productId,
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error("Google Play API access was denied for the subscription verifier.");
    }
    if (response.status === 404) {
      throw new Error("Google Play could not find this purchase for Bible Nova Companion.");
    }
    if (response.status === 429 || response.status >= 500) {
      throw new Error("Google Play purchase verification is temporarily unavailable.");
    }
    throw new Error("Google Play rejected this purchase during verification.");
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
    const acknowledgementEndpoint = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(GOOGLE_PLAY_PACKAGE_NAME)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`;
    const acknowledgementResponse = await fetch(acknowledgementEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    if (!acknowledgementResponse.ok) {
      const acknowledgementError = (await acknowledgementResponse.json().catch(() => ({}))) as GooglePlayErrorResponse;
      console.error("Google Play subscription acknowledgement rejected:", {
        httpStatus: acknowledgementResponse.status,
        apiStatus: acknowledgementError.error?.status,
        reason: acknowledgementError.error?.errors?.[0]?.reason,
        message: acknowledgementError.error?.message?.slice(0, 240),
        packageName: GOOGLE_PLAY_PACKAGE_NAME,
        productId,
      });

      // The native billing client may finish its own asynchronous acknowledgement
      // while the backend request is in flight. Re-read once before treating that
      // harmless race as a failure.
      const refreshedResponse = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const refreshedData = (await refreshedResponse.json().catch(() => ({}))) as {
        acknowledgementState?: string;
      };
      if (
        !refreshedResponse.ok ||
        refreshedData.acknowledgementState !== "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"
      ) {
        throw new Error("This Google Play subscription could not be acknowledged.");
      }
    }
  }

  const verifiedOrderId = lineItem.latestSuccessfulOrderId;
  const verifiedPlanId = lineItem.offerDetails?.basePlanId;

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
  // MediaRecorder commonly includes codec parameters in the MIME metadata,
  // for example: data:audio/webm;codecs=opus;base64,...
  const match = audio.match(/^data:([^,]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw new Error("Audio must be provided as a base64 data URL.");
  }

  const [, metadata, base64] = match;
  const mimeType = normalizeVoiceAudioMimeType(metadata);
  if (!mimeType || !isSupportedVoiceAudioMimeType(mimeType)) {
    throw new Error("Audio must be provided as a base64 data URL.");
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.byteLength) throw new Error("The audio recording is empty.");
  if (buffer.byteLength > MAX_VOICE_AUDIO_BYTES) {
    throw new Error("The audio recording is too large.");
  }

  return {
    mimeType,
    blob: new Blob([new Uint8Array(buffer)], { type: mimeType }),
  };
};

export type ShadowMemoryProfile = {
  memoryEnabled: boolean;
  shadowNotes: string | null;
};

export async function loadShadowMemoryProfile(userId: string): Promise<ShadowMemoryProfile> {
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    return { memoryEnabled: false, shadowNotes: null };
  }

  const { data, error } = await adminClient
    .from(SHADOW_NOTES_TABLE)
    .select("memory_enabled, notes")
    .eq("user_id", userId)
    .maybeSingle<{ memory_enabled: boolean; notes: string | null }>();

  if (error) {
    console.error("Shadow memory load failed:", error.message);
    return { memoryEnabled: false, shadowNotes: null };
  }

  const memoryEnabled = data?.memory_enabled === true;
  return {
    memoryEnabled,
    shadowNotes: memoryEnabled
      ? normalizeShadowNotes(data?.notes)
      : null,
  };
}

export async function saveShadowNotes(userId: string, notes: string) {
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    throw new Error("Shadow note persistence requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const normalizedNotes = normalizeShadowNotes(notes) || "";
  const { data, error } = await adminClient
    .from(SHADOW_NOTES_TABLE)
    .update({
      notes: normalizedNotes,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("memory_enabled", true)
    .select("notes")
    .maybeSingle<{ notes: string | null }>();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeShadowNotes(data?.notes);
}

export async function setShadowMemoryPreference(
  userId: string,
  memoryEnabled: boolean,
): Promise<ShadowMemoryProfile> {
  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    throw new Error("Memory preferences require SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const { data: existing, error: loadError } = await adminClient
    .from(SHADOW_NOTES_TABLE)
    .select("memory_enabled, notes")
    .eq("user_id", userId)
    .maybeSingle<{ memory_enabled: boolean; notes: string | null }>();
  if (loadError) throw new Error(loadError.message);

  if (existing?.memory_enabled === true && memoryEnabled) {
    return {
      memoryEnabled: true,
      shadowNotes: normalizeShadowNotes(existing.notes),
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await adminClient
    .from(SHADOW_NOTES_TABLE)
    .upsert(
      {
        user_id: userId,
        memory_enabled: memoryEnabled,
        memory_consent_updated_at: now,
        notes: "",
        updated_at: now,
      },
      { onConflict: "user_id" },
    )
    .select("memory_enabled, notes")
    .single<{ memory_enabled: boolean; notes: string | null }>();
  if (error) throw new Error(error.message);

  return {
    memoryEnabled: data.memory_enabled === true,
    shadowNotes:
      data.memory_enabled === true
        ? normalizeShadowNotes(data.notes)
        : null,
  };
}

export async function createReflectionResponse(
  userId: string,
  messages: Array<{ role: "user" | "assistant" | "ai" | "model" | "system"; content: string }>,
  _shadowNotes?: string | null,
) {
  const memoryProfile = await loadShadowMemoryProfile(userId);
  const effectiveShadowNotes = memoryProfile.memoryEnabled ? memoryProfile.shadowNotes : null;
  const result = await createReflection(messages, effectiveShadowNotes, {
    rememberUser: memoryProfile.memoryEnabled,
  });

  if (
    memoryProfile.memoryEnabled &&
    result.shadowNotes &&
    result.shadowNotes !== effectiveShadowNotes
  ) {
    try {
      result.shadowNotes = await saveShadowNotes(userId, result.shadowNotes);
    } catch (error) {
      console.error("Shadow notes save failed:", error instanceof Error ? error.message : error);
    }
  }

  return result;
}

export async function createVoiceReflectionResponse(
  _userId: string,
  messages: Array<{ role: "user" | "assistant" | "ai" | "model" | "system"; content: string }>,
  shadowNotes?: string | null,
  voiceLanguage?: VoiceLanguage,
) {
  const effectiveShadowNotes =
    normalizeShadowNotes(shadowNotes);
  return {
    message: await createVoiceResponse(
      messages,
      effectiveShadowNotes,
      normalizeVoiceLanguage(voiceLanguage),
    ),
  };
}

export async function transcribeAudio(
  audio: string | Blob,
  language?: string,
  voiceLanguage: VoiceLanguage = "auto",
) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Speech transcription requires GROQ_API_KEY on the server.");
  }

  const parsedAudio =
    typeof audio === "string"
      ? parseBase64Audio(audio)
      : {
          mimeType: normalizeVoiceAudioMimeType(audio.type),
          blob: audio,
        };
  if (!isSupportedVoiceAudioMimeType(parsedAudio.mimeType)) {
    throw new Error("This audio format is not supported.");
  }
  if (!parsedAudio.blob.size) throw new Error("The audio recording is empty.");
  if (parsedAudio.blob.size > MAX_VOICE_AUDIO_BYTES) {
    throw new Error("The audio recording is too large.");
  }
  const formData = new FormData();
  formData.append(
    "file",
    parsedAudio.blob,
    getVoiceAudioFilename(parsedAudio.mimeType),
  );
  formData.append("model", process.env.GROQ_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3-turbo");
  formData.append("response_format", "json");
  formData.append("temperature", "0");

  if (language) {
    formData.append("language", language);
  }
  formData.append("prompt", getWhisperVocabularyPrompt(voiceLanguage));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeoutId);
  }
}

export const DEFAULT_GOOGLE_TTS_VOICE = "en-AU-Chirp3-HD-Algenib";
export const DEFAULT_GOOGLE_TTS_LANGUAGE = "en-AU";
const DEFAULT_GOOGLE_TTS_ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
const GOOGLE_TTS_REQUEST_TIMEOUT_MS = 9_000;
const GOOGLE_TTS_AUDIO_PROFILES = [
  "handset-class-device",
  "headphone-class-device",
  "small-bluetooth-speaker-class-device",
] as const;

type GoogleTtsAudioProfile = (typeof GOOGLE_TTS_AUDIO_PROFILES)[number];

export type GoogleTtsSynthesisOptions = {
  languageCode?: string;
  voiceName?: string;
  speakingRate?: string | number;
  pitch?: string | number;
  enableSsml?: boolean;
  audioProfile?: string;
};

const getGoogleTtsAudioProfile = (value: string | undefined): GoogleTtsAudioProfile | undefined =>
  GOOGLE_TTS_AUDIO_PROFILES.includes(value as GoogleTtsAudioProfile)
    ? value as GoogleTtsAudioProfile
    : undefined;

export const getGoogleTtsEndpoint = () => {
  const configured = process.env.GOOGLE_TTS_ENDPOINT?.trim();
  if (!configured) return DEFAULT_GOOGLE_TTS_ENDPOINT;

  try {
    const parsed = new URL(configured);
    if (
      parsed.protocol !== "https:" ||
      !/(?:^|[.])[a-z0-9-]*texttospeech[.]googleapis[.]com$/i.test(parsed.hostname)
    ) {
      return DEFAULT_GOOGLE_TTS_ENDPOINT;
    }
    const path = parsed.pathname.replace(/\/+$/, "");
    return path.endsWith(":synthesize")
      ? `${parsed.origin}${path}`
      : `${parsed.origin}${path}/v1/text:synthesize`;
  } catch {
    return DEFAULT_GOOGLE_TTS_ENDPOINT;
  }
};

export const getGoogleTtsOptionsForVoiceLanguage = (
  voiceLanguage: VoiceLanguage,
): GoogleTtsSynthesisOptions => {
  if (voiceLanguage !== "hindi" && voiceLanguage !== "hinglish") return {};
  return {
    languageCode: process.env.GOOGLE_TTS_HINDI_LANGUAGE_CODE?.trim() || "hi-IN",
    voiceName: process.env.GOOGLE_TTS_HINDI_VOICE_NAME?.trim() || "hi-IN-Standard-A",
  };
};

export const getGoogleTtsSynthesisConfig = (
  options: GoogleTtsSynthesisOptions = {},
) => ({
  languageCode:
    options.languageCode?.trim() ||
    process.env.GOOGLE_TTS_LANGUAGE_CODE?.trim() ||
    DEFAULT_GOOGLE_TTS_LANGUAGE,
  voiceName:
    options.voiceName?.trim() ||
    process.env.GOOGLE_TTS_VOICE_NAME?.trim() ||
    DEFAULT_GOOGLE_TTS_VOICE,
  speakingRate: parseGoogleTtsSpeakingRate(
    options.speakingRate ?? process.env.GOOGLE_TTS_SPEAKING_RATE,
  ),
  pitch: parseGoogleTtsPitch(
    options.pitch ?? process.env.GOOGLE_TTS_PITCH,
  ),
  enableSsml:
    options.enableSsml ??
    isGoogleTtsSsmlEnabled(process.env.GOOGLE_TTS_ENABLE_SSML),
  audioProfile: getGoogleTtsAudioProfile(
    options.audioProfile ?? process.env.GOOGLE_TTS_AUDIO_PROFILE,
  ),
});

type GoogleTtsProviderResponse = {
  audioContent?: string;
  error?: { message?: string };
};

const requestGoogleTtsAudio = async ({
  accessToken,
  input,
  voice,
  audioConfig,
}: {
  accessToken: string;
  input: { text: string } | { ssml: string };
  voice: { languageCode: string; name: string };
  audioConfig: {
    audioEncoding: "MP3";
    speakingRate?: number;
    pitch?: number;
    effectsProfileId?: string[];
  };
}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GOOGLE_TTS_REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(getGoogleTtsEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ input, voice, audioConfig }),
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as GoogleTtsProviderResponse;
    return { response, data, durationMs: Date.now() - startedAt };
  } finally {
    clearTimeout(timeoutId);
  }
};

export async function synthesizeSpeech(
  text: string,
  options: GoogleTtsSynthesisOptions = {},
) {
  const normalizedText = normalizeVoiceSpeech(text);
  if (!normalizedText) {
    throw new Error("Text-to-Speech requires a response to read.");
  }

  const config = getGoogleTtsSynthesisConfig(options);
  const auth = getTextToSpeechAuthClient();
  const authStartedAt = Date.now();
  const { token: accessToken } = await auth.getAccessToken();
  const authMs = Date.now() - authStartedAt;
  if (!accessToken) {
    throw new Error("Could not authenticate with Google Cloud Text-to-Speech.");
  }

  const voice = {
    languageCode: config.languageCode,
    name: config.voiceName,
  };
  const withAudioProfile = <T extends { audioEncoding: "MP3" }>(audioConfig: T) =>
    config.audioProfile
      ? { ...audioConfig, effectsProfileId: [config.audioProfile] }
      : audioConfig;
  let synthesisMode: "ssml" | "plain" | "plain-fallback" =
    config.enableSsml ? "ssml" : "plain";
  let result = await requestGoogleTtsAudio({
    accessToken,
    input: config.enableSsml
      ? {
          ssml: createGoogleTtsSsml(normalizedText, {
            speakingRate: config.speakingRate,
            pitch: config.pitch,
          }),
        }
      : { text: normalizedText },
    voice,
    audioConfig: config.enableSsml
      ? withAudioProfile({ audioEncoding: "MP3" })
      : withAudioProfile({
          audioEncoding: "MP3",
          speakingRate: config.speakingRate,
          pitch: config.pitch,
        }),
  });
  let providerMs = result.durationMs;

  const shouldTryPlainText =
    config.enableSsml &&
    !result.data.audioContent &&
    ![401, 403, 429].includes(result.response.status);
  if (shouldTryPlainText) {
    console.warn("[voice/tts] SSML unavailable; retrying with plain text", {
      providerStatus: result.response.status,
      voiceName: config.voiceName,
    });
    synthesisMode = "plain-fallback";
    result = await requestGoogleTtsAudio({
      accessToken,
      input: { text: normalizedText },
      voice,
      audioConfig: withAudioProfile({
        audioEncoding: "MP3",
        speakingRate: config.speakingRate,
        pitch: config.pitch,
      }),
    });
    providerMs += result.durationMs;
  }

  if (!result.response.ok) {
    throw new Error(
      result.data.error?.message || "Text-to-Speech generation failed.",
    );
  }
  if (!result.data.audioContent) {
    throw new Error("Text-to-Speech returned no audio.");
  }
  return {
    audioContent: result.data.audioContent,
    mimeType: "audio/mpeg",
    voiceName: config.voiceName,
    languageCode: config.languageCode,
    speakingRate: config.speakingRate,
    pitch: config.pitch,
    synthesisMode,
    characterCount: normalizedText.length,
    authMs,
    providerMs,
    endpoint: getGoogleTtsEndpoint(),
  };
}

export async function generatePrayer(prompt: string) {
  if (!process.env.GROQ_API_KEY?.trim()) {
    throw new Error("Groq API key is missing. Please configure it in settings.");
  }

  return createChatCompletion([
    {
      role: "user",
      content: `Generate an uplifting, beautifully written 2-sentence Christian prayer based on this prompt: ${prompt}`,
    },
  ]);
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

export function getNativeSubscriptionClientErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("API access was denied")) {
    return "Google Play verification permission is missing. Grant the service account access to orders and subscriptions in Play Console, then try again.";
  }
  if (message.includes("could not find this purchase")) {
    return "Google Play could not find this purchase. Install Bible Nova Companion from a Play testing or production track and purchase with an authorized tester account.";
  }
  if (message.includes("temporarily unavailable")) {
    return "Google Play verification is temporarily unavailable. Please try again shortly.";
  }
  if (message.includes("not active")) {
    return message;
  }
  if (message.includes("could not be acknowledged")) {
    return "Google Play verified the purchase but could not acknowledge it. Please use Restore Purchases shortly.";
  }
  if (message.includes("does not match")) {
    return "This Google Play purchase does not match the selected Bible Nova subscription.";
  }
  if (message.includes("Could not verify the signed-in user") || message.includes("Missing active session")) {
    return message;
  }
  if (message.includes("link_subscription_entitlement") || message.includes("persist the verified")) {
    return "The verified subscription could not be linked to your account. Please try Restore Purchases shortly.";
  }
  return "Google Play could not verify and link this subscription. Please try Restore Purchases or contact support.";
}
