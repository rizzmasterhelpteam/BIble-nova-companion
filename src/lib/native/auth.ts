import { SocialLogin } from "@capgo/capacitor-social-login";
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from "../supabase";
import { getNativePlatform, isNativePlatform } from "./platform";

const googleWebClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() || "";
const googleIOSClientId = import.meta.env.VITE_GOOGLE_IOS_CLIENT_ID?.trim() || "";
const googleIOSServerClientId =
  import.meta.env.VITE_GOOGLE_IOS_SERVER_CLIENT_ID?.trim() || googleWebClientId;

let nativeGoogleAuthInitialized = false;
let nativeGoogleAuthInitializationPromise: Promise<void> | null = null;
let nativeGoogleSignInPromise: Promise<void> | null = null;

const getMissingGoogleConfigMessage = () => {
  if (!isNativePlatform()) {
    return "Native Google sign-in is only available on Android and iOS.";
  }

  const platform = getNativePlatform();
  if (platform === "android" && !googleWebClientId) {
    return "Native Google sign-in is not configured for Android. Set VITE_GOOGLE_WEB_CLIENT_ID.";
  }

  if (platform === "ios" && !googleIOSClientId) {
    return "Native Google sign-in is not configured for iOS. Set VITE_GOOGLE_IOS_CLIENT_ID.";
  }

  return null;
};

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const createRawNonce = () => {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.getRandomValues || !secureCrypto?.subtle) {
    throw new Error("Secure nonce generation is unavailable on this device.");
  }

  const bytes = new Uint8Array(32);
  secureCrypto.getRandomValues(bytes);
  return hex(bytes);
};

const hashNonce = async (value: string) => {
  const secureCrypto = globalThis.crypto;
  if (!secureCrypto?.subtle) {
    throw new Error("Secure nonce hashing is unavailable on this device.");
  }

  const encoded = new TextEncoder().encode(value);
  const digest = await secureCrypto.subtle.digest("SHA-256", encoded);
  return hex(new Uint8Array(digest));
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const base64UrlDecode = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4;
  const padded = normalized + (padding ? "=".repeat(4 - padding) : "");
  const decoded = atob(padded);
  const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const decodeJwtPayload = (idToken: string) => {
  const segments = idToken.split(".");
  if (segments.length < 2) {
    throw new Error("Google returned an invalid ID token.");
  }

  const payload = JSON.parse(base64UrlDecode(segments[1])) as unknown;
  if (!isObject(payload)) {
    throw new Error("Google returned an unreadable ID token payload.");
  }

  return payload;
};

const getValidAudiences = () =>
  [googleWebClientId, googleIOSClientId].filter((value): value is string => Boolean(value));

const validateGoogleIdToken = (idToken: string, expectedNonceDigest: string) => {
  const payload = decodeJwtPayload(idToken);
  const audience = typeof payload.aud === "string" ? payload.aud : null;
  const nonce = typeof payload.nonce === "string" ? payload.nonce : null;

  if (!audience || !getValidAudiences().includes(audience)) {
    throw new Error("Google returned an ID token for an unexpected client ID.");
  }

  if (nonce && nonce !== expectedNonceDigest) {
    throw new Error("Google returned a cached token with the wrong nonce.");
  }
};

const shouldRetryNativeGoogleSignIn = (error: unknown) => {
  const code = isObject(error) && typeof error.code === "string" ? error.code : "";
  if (code === "USER_CANCELLED") {
    return false;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("nonce") || message.includes("audience") || message.includes("token");
};

const createNoncePair = async () => {
  const rawNonce = createRawNonce();
  const nonceDigest = await hashNonce(rawNonce);
  return { rawNonce, nonceDigest };
};

const loginWithNativeGoogleToken = async (retryWithFreshPrompt: boolean) => {
  const { rawNonce, nonceDigest } = await createNoncePair();
  const platform = getNativePlatform();
  const login = await SocialLogin.login({
    provider: "google",
    options: {
      scopes: ["email", "profile"],
      nonce: nonceDigest,
      ...(platform === "android" ? { forceRefreshToken: retryWithFreshPrompt } : {}),
      ...(platform === "ios" ? { forcePrompt: retryWithFreshPrompt } : {}),
    },
  });

  if (login.result.responseType !== "online") {
    throw new Error("Google native sign-in returned an unsupported response type.");
  }

  const { idToken, accessToken } = login.result;
  if (!idToken) {
    throw new Error("Google native sign-in did not return an ID token.");
  }

  validateGoogleIdToken(idToken, nonceDigest);

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    access_token: accessToken?.token || undefined,
    nonce: rawNonce,
  });

  if (error) {
    throw error;
  }
};

export const hasNativeGoogleAuthConfig = () => getMissingGoogleConfigMessage() === null;

export const initializeNativeGoogleAuth = async () => {
  if (!isNativePlatform() || nativeGoogleAuthInitialized) {
    return;
  }

  if (nativeGoogleAuthInitializationPromise) {
    return nativeGoogleAuthInitializationPromise;
  }

  const missingConfigMessage = getMissingGoogleConfigMessage();
  if (missingConfigMessage) {
    throw new Error(missingConfigMessage);
  }

  nativeGoogleAuthInitializationPromise = SocialLogin.initialize({
    google: {
      webClientId: googleWebClientId || undefined,
      iOSClientId: googleIOSClientId || undefined,
      iOSServerClientId: googleIOSServerClientId || undefined,
      mode: "online",
    },
  })
    .then(() => {
      nativeGoogleAuthInitialized = true;
    })
    .catch((error) => {
      nativeGoogleAuthInitialized = false;
      throw error;
    })
    .finally(() => {
      nativeGoogleAuthInitializationPromise = null;
    });

  return nativeGoogleAuthInitializationPromise;
};

export const signInWithGoogleNative = async () => {
  if (!isSupabaseConfigured) {
    throw new Error(supabaseConfigMessage);
  }

  const missingConfigMessage = getMissingGoogleConfigMessage();
  if (missingConfigMessage) {
    throw new Error(missingConfigMessage);
  }

  if (nativeGoogleSignInPromise) {
    return nativeGoogleSignInPromise;
  }

  nativeGoogleSignInPromise = (async () => {
    await initializeNativeGoogleAuth();

    try {
      await loginWithNativeGoogleToken(false);
    } catch (error) {
      if (!shouldRetryNativeGoogleSignIn(error)) {
        throw error;
      }

      await SocialLogin.logout({ provider: "google" }).catch(() => undefined);
      await loginWithNativeGoogleToken(true);
    }
  })().finally(() => {
    nativeGoogleSignInPromise = null;
  });

  return nativeGoogleSignInPromise;
};
