import { Capacitor } from "@capacitor/core";
import { capacitorPlatform } from "./capacitorPlatform";
import { webPlatform } from "./webPlatform";
import type { PlatformAdapter } from "./types";

export const platform: PlatformAdapter = Capacitor.isNativePlatform()
  ? capacitorPlatform
  : webPlatform;

export const getPlatform = () => platform;
