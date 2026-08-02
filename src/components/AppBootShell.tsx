import { useEffect, useRef } from "react";
import { startup } from "../lib/startup";

type AppBootShellProps = {
  message?: string;
  onPainted?: () => void;
};

/**
 * The first React-owned surface shown while auth, routing, or native setup is
 * settling. Keeping this branded and themed prevents a WebView from falling
 * back to a confusing black rectangle during a normal async transition.
 */
export function AppBootShell({
  message = "Preparing your reflection space…",
  onPainted,
}: AppBootShellProps) {
  const hasReportedPaintRef = useRef(false);

  useEffect(() => {
    startup.mark("react-boot-shell-mounted");
    const frame = window.requestAnimationFrame(() => {
      if (hasReportedPaintRef.current) return;
      hasReportedPaintRef.current = true;
      startup.mark("react-boot-shell-painted");
      onPainted?.();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [onPainted]);

  return (
    <main
      className="app-boot-shell fixed inset-0 z-[100] grid min-h-[100dvh] place-items-center px-6 py-10"
      aria-live="polite"
      aria-busy="true"
      style={{
        background: "var(--app-page-bg)",
        color: "var(--app-text)",
        paddingTop: "calc(2.5rem + env(safe-area-inset-top, 0px))",
        paddingBottom: "calc(2.5rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="flex w-full max-w-xs flex-col items-center gap-5 text-center">
        <div
          className="app-boot-shell-mark grid h-20 w-20 place-items-center overflow-hidden rounded-[1.7rem]"
          style={{
            background: "var(--app-surface-elevated)",
            border: "1px solid var(--app-card-border)",
            boxShadow: "var(--app-card-shadow)",
          }}
        >
          <img
            src="/favicon.png"
            alt=""
            className="h-full w-full object-cover"
            width="80"
            height="80"
          />
        </div>
        <div className="space-y-1.5">
          <p className="font-serif text-3xl font-semibold tracking-tight">Bible Nova</p>
          <p className="text-sm opacity-70">{message}</p>
        </div>
        <span
          className="app-boot-shell-spinner h-2.5 w-2.5 rounded-full"
          aria-label="Loading"
          style={{ background: "var(--app-accent)" }}
        />
      </div>
    </main>
  );
}

export default AppBootShell;
