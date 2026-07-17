import { SocialLogin } from "@capgo/capacitor-social-login";
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from "../supabase";
import { getNativePlatform, isNativePlatform } from "./platform";

// Google OAuth client IDs are public identifiers and are embedded in native
// binaries. Keep the environment override for deployments, but retain the
// configured Bible Nova client ID for clean-checkout and web-wrapper builds
// where .env.local is intentionally not committed.
const googleWebClientId =
  import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID?.trim() ||
  "703657955310-qp8chkn81ln736tqo9lev0mj7vo69ui7.apps.googleusercontent.com";
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
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (code === "USER_CANCELLED" || message.includes("cancel")) {
    return false;
  }

  return (
    message.includes("nonce") ||
    message.includes("audience") ||
    message.includes("token") ||
    message.includes("credential") ||
    message.includes("authorize") ||
    message.includes("access token") ||
    message.includes("developer_error")
  );
};

const getNativeGoogleLoginOptions = (nonceDigest: string, retryWithFreshPrompt: boolean) => {
  const platform = getNativePlatform();

  return {
    scopes: ["email", "profile"],
    nonce: nonceDigest,
    ...(platform === "android"
      ? {
          // Use Credential Manager's account picker path. This matches Supabase's
          // native Android guidance and also supports accounts that have not
          // previously authorized this app on the device.
          style: "bottom" as const,
          filterByAuthorizedAccounts: false,
          autoSelectEnabled: false,
          forcePrompt: retryWithFreshPrompt,
          forceRefreshToken: retryWithFreshPrompt,
        }
      : { forcePrompt: retryWithFreshPrompt }),
  };
};

const getNativeGoogleErrorMessage = (error: unknown) => {
  const code = isObject(error) && typeof error.code === "string" ? error.code : "";
  const message = error instanceof Error ? error.message : "";
  const details = `${code} ${message}`.toLowerCase();

  if (details.includes("cancel")) {
    return "Google sign-in was cancelled.";
  }

  if (
    getNativePlatform() === "android" &&
    (details.includes("developer_error") ||
      /\b(?:status|error|code)\s*[:#-]?\s*10\b/.test(details))
  ) {
    return "Google sign-in is not enabled for this Android build. Register this build's SHA-1 certificate for com.biblenovacompanion.app in the Google OAuth Android client, then rebuild and reinstall the app.";
  }

  if (
    details.includes("no credential") ||
    details.includes("no credentials") ||
    details.includes("play services") ||
    details.includes("credential manager")
  ) {
    return "Google sign-in could not find a usable Google account on this device. Update Google Play services, make sure a Google account is signed in, and try again.";
  }

  return message || "Google sign-in failed. Please try again.";
};

const createNoncePair = async () => {
  const rawNonce = createRawNonce();
  const nonceDigest = await hashNonce(rawNonce);
  return { rawNonce, nonceDigest };
};

const loginWithNativeGoogleToken = async (retryWithFreshPrompt: boolean) => {
  const { rawNonce, nonceDigest } = await createNoncePair();
  const login = await SocialLogin.login({
    provider: "google",
    options: getNativeGoogleLoginOptions(nonceDigest, retryWithFreshPrompt),
  });

  if (login.result.responseType !== "online") {
    throw new Error("Google native sign-in returned an unsupported response type.");
  }

  const { idToken } = login.result;
  if (!idToken) {
    throw new Error("Google native sign-in did not return an ID token.");
  }

  validateGoogleIdToken(idToken, nonceDigest);

  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
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
  })()
    .catch((error) => {
      throw new Error(getNativeGoogleErrorMessage(error));
    })
    .finally(() => {
      nativeGoogleSignInPromise = null;
    });

  return nativeGoogleSignInPromise;
};
