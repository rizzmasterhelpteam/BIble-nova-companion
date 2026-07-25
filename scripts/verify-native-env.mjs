import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

const rawApiBaseUrl = process.env.VITE_API_BASE_URL?.trim();

if (!rawApiBaseUrl) {
  console.error("Native build blocked: VITE_API_BASE_URL is missing.");
  process.exit(1);
}

let apiBaseUrl;
try {
  apiBaseUrl = new URL(rawApiBaseUrl);
} catch {
  console.error("Native build blocked: VITE_API_BASE_URL is not a valid URL.");
  process.exit(1);
}

const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
if (apiBaseUrl.protocol !== "https:") {
  console.error("Native build blocked: VITE_API_BASE_URL must use HTTPS.");
  process.exit(1);
}
if (localHosts.has(apiBaseUrl.hostname.toLowerCase())) {
  console.error("Native build blocked: VITE_API_BASE_URL cannot point to localhost.");
  process.exit(1);
}

console.log(`Native API configuration verified: ${apiBaseUrl.origin}`);
