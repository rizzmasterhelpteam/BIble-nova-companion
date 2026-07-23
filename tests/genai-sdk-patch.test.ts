import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Google GenAI history-config compatibility patch", () => {
  it.each([
    ["browser ESM", "web/index.mjs"],
    ["Node ESM", "node/index.mjs"],
    ["Node CommonJS", "node/index.cjs"],
    ["default ESM", "index.mjs"],
    ["default CommonJS", "index.cjs"],
  ])("forwards historyConfig in the %s serializer", (_label, runtimePath) => {
    const sdkPath = path.join(
      process.cwd(),
      "node_modules",
      "@google",
      "genai",
      "dist",
      runtimePath,
    );
    const source = fs.readFileSync(sdkPath, "utf8");

    expect(source).toContain("['setup', 'historyConfig']");
  });
});
