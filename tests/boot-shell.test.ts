import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const authSource = readFileSync(new URL("../src/context/AuthContext.tsx", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const layoutSource = readFileSync(new URL("../src/components/Layout.tsx", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("../src/context/ThemeContext.tsx", import.meta.url), "utf8");

describe("Android/WebView boot stability", () => {
  it("uses a themed boot shell instead of a black global loader", () => {
    expect(appSource).toContain("AppBootShell");
    expect(appSource).not.toContain("FullScreenLoader");
    expect(appSource).not.toContain("bg-black");
    expect(indexSource).toContain('id="initial-app-shell"');
    expect(indexSource).not.toContain("background: #000000");
  });

  it("bootstraps theme before styles and keeps the native splash handoff observable", () => {
    expect(indexSource).toContain("theme-bootstrap-applied");
    expect(appSource).toContain("native-splash-hide-start");
    expect(appSource).toContain("native-splash-hide-complete");
    expect(appSource).toContain("native-splash-safety-timeout");
    expect(themeSource).toContain("updateNativeStatusBarTheme");
  });

  it("does not remount the whole route tree for every top-level transition", () => {
    expect(appSource).not.toContain("React.Fragment key={topKey}");
    expect(layoutSource).toContain("RouteContentFallback");
    expect(layoutSource).toContain("<Suspense fallback={<RouteContentFallback />}");
  });

  it("keeps subscription refreshes non-blocking after the initial check", () => {
    expect(authSource).toContain("{ initial = false }");
    expect(authSource).toContain("if (initial) setIsSubscriptionResolved(false)");
    expect(authSource).toContain("Premium access could not be refreshed");
    expect(authSource).toContain("isSubscriptionRevalidating");
  });
});
