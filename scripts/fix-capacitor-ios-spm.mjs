import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageSwiftPath = path.join(rootDir, "ios", "App", "CapApp-SPM", "Package.swift");

if (!existsSync(packageSwiftPath)) {
  process.exit(0);
}

const source = readFileSync(packageSwiftPath, "utf8");
const fixed = source.replace(/path: "([^"]+)"/g, (_match, packagePath) => {
  return `path: "${packagePath.replace(/\\/g, "/")}"`;
});

if (fixed !== source) {
  writeFileSync(packageSwiftPath, fixed);
  console.log("Fixed iOS Capacitor SPM package paths.");
}
