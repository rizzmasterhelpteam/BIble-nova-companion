import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shellDir = join(root, "native-shell");
const requiredFiles = new Set(["index.html", "native-error.html", "app-icon.png"]);
const generatedCapacitorFiles = new Set(["cordova.js", "cordova_plugins.js"]);

const collectFiles = (directory, baseDirectory = directory) => {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = join(directory, entry.name);
    return entry.isDirectory()
      ? collectFiles(entryPath, baseDirectory)
      : [relative(baseDirectory, entryPath).replaceAll("\\", "/")];
  });
};

if (!existsSync(shellDir)) {
  console.error("Native shell verification failed: native-shell/ is missing.");
  process.exit(1);
}

const shellFiles = new Set(collectFiles(shellDir));
const shellMismatch = [...shellFiles].some((file) => !requiredFiles.has(file)) ||
  [...requiredFiles].some((file) => !shellFiles.has(file));
if (shellMismatch) {
  console.error(`Native shell verification failed. Allowed files: ${[...requiredFiles].join(", ")}`);
  process.exit(1);
}

const androidPublicDir = join(root, "android", "app", "src", "main", "assets", "public");
if (existsSync(androidPublicDir)) {
  const packagedFiles = new Set(collectFiles(androidPublicDir));
  const packagedMismatch = [...packagedFiles].some((file) => !requiredFiles.has(file) && !generatedCapacitorFiles.has(file)) ||
    [...requiredFiles].some((file) => !packagedFiles.has(file));
  if (packagedMismatch) {
    console.error("Native shell verification failed: Android assets contain the full React bundle or unexpected files.");
    console.error(`Packaged files: ${[...packagedFiles].join(", ")}`);
    process.exit(1);
  }
  const indexPath = join(androidPublicDir, "index.html");
  const index = readFileSync(indexPath, "utf8");
  if (index.includes("assets/index-") || index.includes("<script type=\"module\" src=")) {
    console.error("Native shell verification failed: Vite application assets were packaged into Android.");
    process.exit(1);
  }
}

const icon = statSync(join(shellDir, "app-icon.png"));
if (icon.size < 1024) {
  console.error("Native shell verification failed: app-icon.png is unexpectedly small.");
  process.exit(1);
}

console.log("Native shell verified: minimal emergency assets only.");
