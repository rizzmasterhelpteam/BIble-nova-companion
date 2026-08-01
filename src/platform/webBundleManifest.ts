import { API_CONTRACT_VERSION, NATIVE_BRIDGE_VERSION } from "./types";

export const WEB_BUNDLE_MANIFEST_VERSION = 1 as const;

export type WebBundleManifest = {
  manifestVersion: typeof WEB_BUNDLE_MANIFEST_VERSION;
  bundleVersion: string;
  buildId: string;
  minNativeBridgeVersion: number;
  maxNativeBridgeVersion?: number;
  apiContractVersion: typeof API_CONTRACT_VERSION;
  checksumSha256: string;
  signature: string;
  publishedAt: string;
  assetUrl: string;
};

export const isCompatibleWebBundle = (manifest: WebBundleManifest) =>
  manifest.manifestVersion === WEB_BUNDLE_MANIFEST_VERSION &&
  manifest.minNativeBridgeVersion <= NATIVE_BRIDGE_VERSION &&
  (manifest.maxNativeBridgeVersion === undefined ||
    manifest.maxNativeBridgeVersion >= NATIVE_BRIDGE_VERSION) &&
  manifest.apiContractVersion === API_CONTRACT_VERSION;
