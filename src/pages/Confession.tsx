import { useEffect, useState } from "react";
import { Flame, Wind, Eraser } from "lucide-react";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import PageHeader from "../components/PageHeader";
import { useMobileViewport } from "../context/MobileViewportContext";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

export default function Confession() {
  useDocumentTitle("Confess | Bible Nova Companion");
  const { isCompactPhone, isShortPhone, visibleHeight } = useMobileViewport();
  const isCrampedPhone = visibleHeight > 0 && visibleHeight <= 620;
  const [confession, setConfession] = useState("");
  const [isReleasing, setIsReleasing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(5);
  const [isDone, setIsDone] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const isAndroidApp = isNativePlatform() && getNativePlatform() === "android";
  const isPerformanceMode = Boolean(prefersReducedMotion || isAndroidApp);
  const burnAnimationEnabled = !prefersReducedMotion;
  const burnDuration = prefersReducedMotion ? 1 : 5;

  useEffect(() => {
    let timer: number | null = null;

    if (isReleasing && timeLeft > 0) {
      timer = window.setTimeout(
        () => setTimeLeft((prev) => prev - 1),
        prefersReducedMotion ? 100 : 1000,
      );
    } else if (isReleasing && timeLeft === 0) {
      setIsDone(true);
      setIsReleasing(false);
      setConfession("");
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isReleasing, prefersReducedMotion, timeLeft]);

  const handleRelease = () => {
    if (!confession.trim()) return;
    setTimeLeft(prefersReducedMotion ? 1 : 5);
    setIsReleasing(true);
  };

  const cancelRelease = () => {
    setIsReleasing(false);
    setTimeLeft(5);
  };

  const completeRelease = () => setTimeLeft(0);

  const hasContent = confession.trim().length > 0;
  const panelHeight = isCrampedPhone
    ? "min(31vh, 11rem)"
    : isShortPhone
      ? "min(38vh, 15rem)"
      : "min(46vh, 18rem)";

  return (
    <div
      className={cn(
        "app-scroll-region flex min-h-0 flex-1 flex-col px-4 pb-6 pt-3 sm:px-6",
        isCompactPhone && "px-3 pb-5 pt-2",
      )}
    >
      <PageHeader
        eyebrow="Unburden"
        title="Let it go"
        description="Write down what feels heavy. When you are ready, release it and let it disappear."
        className={cn("relative z-40", isCrampedPhone ? "mb-3" : isShortPhone ? "mb-5" : "mb-6 sm:mb-10")}
      />

      <AnimatePresence mode="wait">
        {!isDone ? (
          <motion.div
            key="confession-box"
            initial={isPerformanceMode ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={isPerformanceMode ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(10px)" }}
            transition={{ duration: isPerformanceMode ? 0.15 : 0.5 }}
            className={cn("relative flex flex-1 flex-col", isCrampedPhone ? "gap-4" : "gap-6")}
          >
            <motion.div
              className="app-panel group relative w-full overflow-hidden rounded-[2rem] border shadow-2xl transition-colors"
              style={{ height: panelHeight, minHeight: isCrampedPhone ? "10.5rem" : isShortPhone ? "13rem" : "15rem" }}
              animate={
                isReleasing && burnAnimationEnabled
                  ? {
                      scale: [1, 0.995, 0.97, 0.9, 0.82],
                      rotate: [0, -0.35, 0.35, -0.5, 0],
                      opacity: [1, 1, 0.94, 0.55, 0],
                      filter: [
                        "brightness(1)",
                        "brightness(1.18) sepia(35%) saturate(140%)",
                        "brightness(0.84) sepia(80%) saturate(120%)",
                        "brightness(0.45) sepia(100%) saturate(80%)",
                        "brightness(0) grayscale(100%)",
                      ],
                    }
                  : isReleasing
                    ? { opacity: [1, 0] }
                    : hasContent && !isPerformanceMode
                      ? {
                          boxShadow: [
                            "0 0 0px 0px rgba(245,158,11,0)",
                            "0 0 18px 4px rgba(245,158,11,0.18)",
                            "0 0 8px 2px rgba(245,158,11,0.08)",
                            "0 0 18px 4px rgba(245,158,11,0.18)",
                          ],
                        }
                      : { boxShadow: "0 0 0px 0px rgba(245,158,11,0)" }
              }
              transition={
                isReleasing
                  ? { duration: burnAnimationEnabled ? burnDuration : 0.45, ease: "easeIn" }
                  : { duration: isPerformanceMode ? 0 : 2.5, repeat: isPerformanceMode ? 0 : Infinity, ease: "easeInOut" }
              }
            >
              <textarea
                value={confession}
                onChange={(event) => setConfession(event.target.value)}
                disabled={isReleasing}
                placeholder="I confess that..."
                aria-label="Confession"
                enterKeyHint="done"
                className={cn(
                  "app-heading relative z-10 h-full w-full resize-none bg-transparent p-5 font-serif italic leading-[1.8] outline-none transition-opacity focus-visible:outline-none",
                  isCrampedPhone ? "p-4 text-[16px]" : isCompactPhone ? "text-[16px] sm:p-6" : "text-[17px] sm:p-8",
                  isReleasing && "pointer-events-none opacity-80",
                )}
              />

              {hasContent && !isReleasing && (
                <span className="app-soft pointer-events-none absolute bottom-3 right-4 z-20 text-[11px] font-sans">
                  {confession.trim().length} characters
                </span>
              )}

              {isReleasing && burnAnimationEnabled && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.18, 0.3, 0.16, 0] }}
                    transition={{ duration: burnDuration, ease: "easeInOut" }}
                    className="pointer-events-none absolute inset-0 z-20"
                    style={{
                      background:
                        "radial-gradient(circle at 50% 100%, rgba(255, 160, 58, 0.62) 0%, rgba(234, 76, 31, 0.22) 42%, transparent 76%)",
                    }}
                  />
                  <motion.div
                    initial={{ top: "100%" }}
                    animate={{ top: "-18%", opacity: [0.9, 0.9, 0.72, 0.34, 0] }}
                    transition={{ duration: burnDuration, ease: "linear" }}
                    className="pointer-events-none absolute left-[-8%] right-[-8%] z-20 h-[76%] rounded-[50%]"
                    style={{
                      background:
                        "linear-gradient(0deg, rgba(237, 76, 28, 0.92) 0%, rgba(255, 171, 48, 0.76) 34%, rgba(255, 220, 112, 0.18) 68%, transparent 100%)",
                    }}
                  />
                  <motion.div
                    initial={{ top: "92%", opacity: 0 }}
                    animate={{ top: "-12%", opacity: [0, 0.9, 0.8, 0.25, 0] }}
                    transition={{ duration: burnDuration * 0.78, ease: "linear", delay: 0.15 }}
                    className="pointer-events-none absolute left-[8%] right-[8%] z-30 h-12 rounded-[50%]"
                    style={{
                      background:
                        "linear-gradient(0deg, transparent 0%, rgba(255, 215, 104, 0.94) 50%, transparent 100%)",
                    }}
                  />
                </>
              )}
            </motion.div>

            <div className="app-muted flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 flex-1 leading-relaxed">This note stays only in this temporary field.</span>
              <button
                onClick={() => setConfession("")}
                disabled={!hasContent || isReleasing}
                className="touch-target app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                <Eraser className="w-3.5 h-3.5" />
                Clear
              </button>
            </div>

            <button
              onClick={handleRelease}
              disabled={!hasContent || isReleasing}
              aria-busy={isReleasing}
              className={cn(
                "touch-target z-30 mt-auto flex w-full flex-col items-center justify-center gap-2 rounded-card font-medium shadow-lg transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]",
                isCrampedPhone ? "py-3.5" : isCompactPhone ? "py-4" : "py-5",
                isReleasing
                  ? "app-secondary-button"
                  : "app-primary-button text-white disabled:opacity-40",
              )}
            >
              {isReleasing ? (
                <div className="flex items-center gap-3">
                  <Flame className="w-5 h-5 animate-bounce" />
                  <span className="font-semibold tracking-[0.2em] uppercase text-xs flex items-center gap-2">
                    <span className="w-16 text-right">Burning</span>
                    <span className="app-soft">|</span>
                    <span className="w-8 text-left">{timeLeft}s</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Flame strokeWidth={2} className="w-[18px] h-[18px]" />
                  <span className="font-semibold text-[15px] tracking-wide">Release to the fire</span>
                </div>
              )}
            </button>
            {isReleasing && <div className="-mt-3 flex justify-center gap-3" aria-live="polite"><button onClick={cancelRelease} className="touch-target app-secondary-button rounded-pill px-4 py-2 text-sm">Cancel</button><button onClick={completeRelease} className="touch-target app-ghost-button rounded-pill px-4 py-2 text-sm">Skip animation</button><span className="sr-only">Release completes in {timeLeft} seconds</span></div>}
          </motion.div>
        ) : (
          <motion.div
            key="success-message"
                initial={prefersReducedMotion || isAndroidApp ? false : { opacity: 0, scale: 0.8, filter: "blur(5px)" }}
                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: prefersReducedMotion || isAndroidApp ? 0.15 : 1, delay: prefersReducedMotion || isAndroidApp ? 0 : 0.2 }}
            className={cn("flex flex-1 flex-col items-center justify-center", isShortPhone ? "" : "-mt-16")}
          >
            <div className="relative mb-8">
              <motion.div
                animate={prefersReducedMotion || isAndroidApp ? undefined : { scale: [1, 1.18, 1], opacity: [0.3, 0.1, 0.3] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full blur-md"
                style={{ background: "var(--app-accent-soft)" }}
              />
              <motion.div
                animate={prefersReducedMotion || isAndroidApp ? undefined : { y: [0, -10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="glass relative flex h-24 w-24 items-center justify-center rounded-full border"
                style={{
                  background: "var(--app-accent-soft)",
                  color: "var(--app-accent)",
                  borderColor: "color-mix(in srgb, var(--app-accent) 22%, transparent)",
                  boxShadow: "0 0 40px color-mix(in srgb, var(--app-accent) 14%, transparent)",
                }}
              >
                <Wind className="w-10 h-10" />
              </motion.div>
            </div>
            <p className="app-heading px-6 text-center text-xl font-serif italic leading-relaxed">
              Your burden has lifted.
              <br />
              <span className="app-muted text-lg">
                The ashes are gone with the wind.
              </span>
            </p>
            <button onClick={() => { setIsDone(false); setTimeLeft(5); }} className="touch-target app-secondary-button mt-8 rounded-pill px-5 py-3 font-semibold">Write another</button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
