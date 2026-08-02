import { Capacitor, registerPlugin } from "@capacitor/core";
import { MINIMUM_NATIVE_BRIDGE_VERSION } from "../../../platform-contract";
import type { NativeRuntimeInfo } from "../../platform/types";

type NativeRuntimePlugin = {
  getInfo: () => Promise<{ bridgeVersion: number }>;
};

const NativeRuntime = registerPlugin<NativeRuntimePlugin>("NativeRuntime");
const RUNTIME_INFO_TIMEOUT_MS = 3_000;

const getPlatform = (): NativeRuntimeInfo["platform"] => {
  if (!Capacitor.isNativePlatform()) return "web";
  return Capacitor.getPlatform() === "android" ? "android" : "ios";
};

const webRuntime: NativeRuntimeInfo = {
  platform: "web",
  appVersion: "web",
  buildNumber: "web",
  bridgeVersion: Number.MAX_SAFE_INTEGER,
};

const withRuntimeTimeout = <T,>(operation: Promise<T>, label: string) =>
  new Promise<T>((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(
      () => reject(new Error(`${label} timed out.`)),
      RUNTIME_INFO_TIMEOUT_MS,
    );
    operation.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

/**
 * Gets the runtime values from the installed native application, never from
 * the remotely hosted JavaScript bundle. Android's bridge value comes from a
 * BuildConfig field exposed by NativeRuntimePlugin.
 */
export const getInstalledNativeRuntimeInfo = async (): Promise<NativeRuntimeInfo> => {
  const platform = getPlatform();
  if (platform === "web") return webRuntime;

  const [{ App }, bridgeInfo] = await withRuntimeTimeout(
    Promise.all([import("@capacitor/app"), NativeRuntime.getInfo()]),
    "Native runtime bridge",
  );
  const appInfo = await withRuntimeTimeout(App.getInfo(), "Native app information");
  const bridgeVersion = Number(bridgeInfo.bridgeVersion);
  if (!Number.isInteger(bridgeVersion) || bridgeVersion < 1) {
    throw new Error("The installed native bridge did not report a valid version.");
  }

  return {
    platform,
    appVersion: appInfo.version,
    buildNumber: appInfo.build,
    bridgeVersion,
  };
};

export const isNativeRuntimeCompatible = (
  runtime: NativeRuntimeInfo,
  minimumBridgeVersion: number = MINIMUM_NATIVE_BRIDGE_VERSION,
) => runtime.platform === "web" || runtime.bridgeVersion >= minimumBridgeVersion;
