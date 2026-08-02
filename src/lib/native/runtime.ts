import { Capacitor } from "@capacitor/core";
import {
  MINIMUM_NATIVE_BRIDGE_VERSION,
  NATIVE_BRIDGE_VERSION,
} from "../../../platform-contract";
import type { NativeRuntimeInfo } from "../../platform/types";

const appVersion = () => import.meta.env.VITE_APP_VERSION?.trim() || "1.1.8";
const buildNumber = () => import.meta.env.VITE_APP_BUILD_NUMBER?.trim() || "11";

export const getNativeRuntimeInfo = (): NativeRuntimeInfo => ({
  platform: Capacitor.isNativePlatform()
    ? Capacitor.getPlatform() === "android"
      ? "android"
      : "ios"
    : "web",
  appVersion: appVersion(),
  buildNumber: buildNumber(),
  bridgeVersion: NATIVE_BRIDGE_VERSION,
});

export const isNativeRuntimeCompatible = (runtime: NativeRuntimeInfo) =>
  runtime.platform === "web" || runtime.bridgeVersion >= MINIMUM_NATIVE_BRIDGE_VERSION;
