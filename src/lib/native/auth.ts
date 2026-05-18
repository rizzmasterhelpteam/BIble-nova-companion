import { Browser } from "@capacitor/browser";
import { isSupabaseConfigured, supabase } from "../supabase";
import { isNativePlatform } from "./platform";

// Keep this in sync with the native URL scheme registered in Android/iOS.
const NATIVE_AUTH_SCHEME = "com.biblenovacompanion.app";
const NATIVE_AUTH_HOST = "auth";
const NATIVE_AUTH_PATH = "/callback";
const NATIVE_AUTH_CALLBACK_URL = `${NATIVE_AUTH_SCHEME}://${NATIVE_AUTH_HOST}${NATIVE_AUTH_PATH}`;

const getUrlParams = (url: string) => {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.search);
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;

  if (hash) {
    for (const [key, value] of new URLSearchParams(hash).entries()) {
      params.set(key, value);
    }
  }

  return params;
};

export const isNativeAuthCallbackUrl = (url: string) => url.startsWith(NATIVE_AUTH_CALLBACK_URL);

export const openGoogleNativeAuth = async () => {
  if (!isNativePlatform()) {
    throw new Error("Native Google sign-in is only available on Android and iOS.");
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: NATIVE_AUTH_CALLBACK_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    throw error;
  }

  if (!data?.url) {
    throw new Error("Supabase did not return a Google sign-in URL.");
  }

  await Browser.open({
    url: data.url,
    presentationStyle: "fullscreen",
  });
};

export const completeNativeAuthFromUrl = async (url: string) => {
  if (!isNativePlatform() || !isSupabaseConfigured || !isNativeAuthCallbackUrl(url)) {
    return false;
  }

  const params = getUrlParams(url);
  const errorDescription = params.get("error_description");
  const errorCode = params.get("error_code") || params.get("error");

  if (errorDescription || errorCode) {
    throw new Error(errorDescription || errorCode || "Native sign-in failed.");
  }

  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return false;
  }

  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });

  if (error) {
    throw error;
  }

  await Browser.close().catch(() => undefined);
  return true;
};
