import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const productionUrl = process.env.CAPACITOR_PRODUCTION_URL?.trim() || "https://biblecompanion.vercel.app";
const useDevServer = process.env.CAPACITOR_USE_DEV_SERVER === "true";
const selectedUrl = useDevServer
  ? process.env.CAPACITOR_DEV_SERVER_URL?.trim()
  : productionUrl;

if (!selectedUrl) {
  console.error("Native build blocked: CAPACITOR_DEV_SERVER_URL is required for dev-server mode.");
  process.exit(1);
}

let remoteUrl;
try {
  remoteUrl = new URL(selectedUrl);
} catch {
  console.error("Native build blocked: Capacitor remote URL is invalid.");
  process.exit(1);
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
if (useDevServer) {
  if (!["http:", "https:"].includes(remoteUrl.protocol)) {
    console.error("Native dev server URL must use http or https.");
    process.exit(1);
  }
  if (localHosts.has(remoteUrl.hostname.toLowerCase())) {
    console.error("Native dev server URL must use a reachable LAN address on Android.");
    process.exit(1);
  }
} else if (remoteUrl.protocol !== "https:" || remoteUrl.hostname !== "biblecompanion.vercel.app") {
  console.error("Native production URL must be https://biblecompanion.vercel.app.");
  process.exit(1);
}

console.log(`Native remote UI configuration verified: ${remoteUrl.origin}`);
