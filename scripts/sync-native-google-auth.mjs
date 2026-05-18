import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const infoPlistPath = path.join(rootDir, "ios", "App", "App", "Info.plist");

for (const fileName of [".env.local", ".env"]) {
  const envPath = path.join(rootDir, fileName);
  if (existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

if (!existsSync(infoPlistPath)) {
  process.exit(0);
}

const iosClientId = process.env.VITE_GOOGLE_IOS_CLIENT_ID?.trim() || "";
const suffix = iosClientId.endsWith(".apps.googleusercontent.com")
  ? iosClientId.slice(0, -".apps.googleusercontent.com".length)
  : "";
const reversedClientId = suffix ? `com.googleusercontent.apps.${suffix}` : "";

const source = readFileSync(infoPlistPath, "utf8");
const replacementBlock = reversedClientId
  ? `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleTypeRole</key>
\t\t\t<string>Editor</string>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>google-sign-in</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${reversedClientId}</string>
\t\t\t</array>
\t\t</dict>
\t</array>`
  : "";

const updated = source.replace(
  /\t<!-- GOOGLE_SIGN_IN_URL_TYPES_START -->[\s\S]*?\t<!-- GOOGLE_SIGN_IN_URL_TYPES_END -->/,
  `\t<!-- GOOGLE_SIGN_IN_URL_TYPES_START -->\n${replacementBlock ? `${replacementBlock}\n` : ""}\t<!-- GOOGLE_SIGN_IN_URL_TYPES_END -->`,
);

if (updated !== source) {
  writeFileSync(infoPlistPath, updated);
  if (reversedClientId) {
    console.log(`Synced iOS Google URL scheme: ${reversedClientId}`);
  } else {
    console.log("Removed iOS Google URL scheme because VITE_GOOGLE_IOS_CLIENT_ID is not set.");
  }
}
