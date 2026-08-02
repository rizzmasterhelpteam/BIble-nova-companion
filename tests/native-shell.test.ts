import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const shellDir = join(root, "native-shell");

describe("remote Capacitor UI shell", () => {
  it("contains only the minimal fallback files", () => {
    expect(existsSync(shellDir)).toBe(true);
    expect(readdirSync(shellDir).sort()).toEqual(["app-icon.png", "index.html", "native-error.html"]);
    expect(readFileSync(join(shellDir, "index.html"), "utf8")).not.toContain("assets/index-");
    expect(readFileSync(join(shellDir, "index.html"), "utf8")).toContain("Retry");
    const errorShell = readFileSync(join(shellDir, "native-error.html"), "utf8");
    expect(errorShell).toContain("https://biblecompanion.vercel.app/?nativeRetry=");
    expect(errorShell).not.toContain("onclick=\"window.location.reload()\"");
  });

  it("configures Capacitor to load the Vercel UI remotely", () => {
    const config = readFileSync(join(root, "capacitor.config.ts"), "utf8");
    expect(config).toContain('webDir: "native-shell"');
    expect(config).toContain("https://biblecompanion.vercel.app");
    expect(config).toContain("CAPACITOR_USE_DEV_SERVER");
  });
});
