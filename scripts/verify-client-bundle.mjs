import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const forbidden = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_PLAY_SERVICE_ACCOUNT_JSON",
  "GOOGLE_TTS_SERVICE_ACCOUNT_JSON",
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "-----BEGIN PRIVATE KEY-----",
  '"service_role"',
];

const collect = (directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : [path];
  });
};

if (!existsSync(dist)) {
  console.error("Client bundle verification failed: dist/ does not exist. Run npm run build first.");
  process.exit(1);
}

const files = collect(dist).filter((path) => /\.(?:js|mjs|map|html|json)$/i.test(path));
const violations = [];
for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const marker of forbidden) {
    if (contents.includes(marker)) violations.push(marker);
  }
}

if (violations.length) {
  console.error("Client bundle verification failed: server-only credential markers were bundled.");
  process.exit(1);
}

console.log(`Client bundle verified: ${files.length} generated files contain no server credentials.`);
