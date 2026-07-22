import { useEffect, useState } from "react";
import { Flame, Wind, Eraser } from "lucide-react";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import PageHeader from "../components/PageHeader";
import { useMobileViewport } from "../context/MobileViewportContext";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

const BURN_EMBERS = [
  { left: "16%", bottom: "14%", size: "5px", color: "rgba(255, 211, 112, 0.95)", drift: -14, rise: -112, delay: 0.05 },
  { left: "29%", bottom: "10%", size: "4px", color: "rgba(255, 153, 66, 0.9)", drift: 11, rise: -86, delay: 0.22 },
  { left: "47%", bottom: "12%", size: "6px", color: "rgba(255, 226, 145, 0.98)", drift: -7, rise: -132, delay: 0.1 },
  { left: "64%", bottom: "9%", size: "4px", color: "rgba(255, 137, 51, 0.88)", drift: 16, rise: -96, delay: 0.34 },
  { left: "79%", bottom: "15%", size: "5px", color: "rgba(255, 202, 99, 0.92)", drift: -10, rise: -118, delay: 0.18 },
] as const;

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
                      y: [0, -1, -2, -6, -12],
                      scale: [1, 1.002, 1.005, 1.01, 1.016],
                      opacity: [1, 1, 0.98, 0.8, 0],
                      boxShadow: [
                        "0 14px 34px rgba(12, 12, 18, 0.06)",
                        "0 14px 38px rgba(244, 132, 45, 0.12)",
                        "0 12px 40px rgba(244, 132, 45, 0.18)",
                        "0 8px 34px rgba(244, 132, 45, 0.12)",
                        "0 4px 22px rgba(244, 132, 45, 0)",
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
              <motion.textarea
                value={confession}
                onChange={(event) => setConfession(event.target.value)}
                disabled={isReleasing}
                placeholder="I confess that..."
                aria-label="Confession"
                enterKeyHint="done"
                animate={
                  isReleasing && burnAnimationEnabled
                    ? {
                        opacity: [1, 0.96, 0.72, 0.22, 0],
                        y: [0, -1, -4, -10, -18],
                        filter: ["blur(0px)", "blur(0px)", "blur(0.5px)", "blur(2px)", "blur(6px)"],
                      }
                    : isReleasing
                      ? { opacity: 0.2 }
                      : { opacity: 1, y: 0, filter: "blur(0px)" }
                }
                transition={{
                  duration: isReleasing ? (burnAnimationEnabled ? burnDuration : 0.45) : 0.25,
                  ease: "easeOut",
                }}
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
                    aria-hidden="true"
                    initial={{ opacity: 0, scale: 0.82 }}
                    animate={{ opacity: [0, 0.12, 0.2, 0.1, 0], scale: [0.82, 0.98, 1.04, 1.1, 1.18] }}
                    transition={{ duration: burnDuration, ease: "easeInOut" }}
                    className="pointer-events-none absolute inset-x-[-18%] bottom-[-42%] z-20 h-[100%] rounded-[50%]"
                    style={{
                      background:
                        "radial-gradient(ellipse at 50% 100%, rgba(255, 186, 74, 0.72) 0%, rgba(239, 91, 35, 0.3) 32%, rgba(239, 91, 35, 0.08) 58%, transparent 78%)",
                      filter: "blur(10px)",
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    initial={{ y: "8%", opacity: 0, scaleX: 0.9 }}
                    animate={{
                      y: ["8%", "-8%", "-34%", "-72%", "-112%"],
                      opacity: [0, 0.7, 0.58, 0.22, 0],
                      scaleX: [0.9, 1.04, 1, 0.95, 0.84],
                    }}
                    transition={{ duration: burnDuration, ease: "easeIn" }}
                    className="pointer-events-none absolute bottom-[-36%] left-[-18%] right-[-18%] z-20 h-[84%] rounded-[50%]"
                    style={{
                      background:
                        "radial-gradient(ellipse at 50% 100%, rgba(247, 86, 29, 0.9) 0%, rgba(255, 158, 57, 0.62) 28%, rgba(255, 208, 105, 0.18) 56%, transparent 78%)",
                      filter: "blur(8px)",
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    initial={{ y: "10%", opacity: 0, scaleX: 0.72 }}
                    animate={{
                      y: ["10%", "-12%", "-48%", "-106%"],
                      opacity: [0, 0.82, 0.42, 0],
                      scaleX: [0.72, 1, 0.9, 0.7],
                    }}
                    transition={{ duration: burnDuration * 0.82, ease: "easeIn", delay: 0.12 }}
                    className="pointer-events-none absolute bottom-[-24%] left-[10%] right-[10%] z-30 h-[56%] rounded-[50%]"
                    style={{
                      background:
                        "radial-gradient(ellipse at 50% 100%, rgba(255, 229, 151, 0.88) 0%, rgba(255, 178, 74, 0.36) 35%, transparent 72%)",
                      filter: "blur(5px)",
                    }}
                  />
                  {BURN_EMBERS.map((ember) => (
                    <motion.span
                      key={`${ember.left}-${ember.bottom}`}
                      aria-hidden="true"
                      initial={{ opacity: 0, x: 0, y: 0, scale: 0.35 }}
                      animate={{
                        opacity: [0, 0.95, 0.7, 0],
                        x: [0, ember.drift * 0.35, ember.drift, ember.drift * 1.3],
                        y: [0, ember.rise * 0.35, ember.rise * 0.78, ember.rise],
                        scale: [0.35, 1, 0.7, 0],
                      }}
                      transition={{ duration: burnDuration * 0.72, delay: ember.delay, ease: "easeOut" }}
                      className="pointer-events-none absolute z-40 rounded-full"
                      style={{
                        left: ember.left,
                        bottom: ember.bottom,
                        width: ember.size,
                        height: ember.size,
                        background: ember.color,
                        boxShadow: `0 0 12px ${ember.color}`,
                      }}
                    />
                  ))}
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
                  <motion.span
                    aria-hidden="true"
                    animate={burnAnimationEnabled ? { scale: [1, 1.08, 1], rotate: [-4, 4, -4], opacity: [0.82, 1, 0.82] } : undefined}
                    transition={{ duration: 1.15, repeat: Infinity, ease: "easeInOut" }}
                    className="inline-flex"
                  >
                    <Flame className="h-5 w-5" />
                  </motion.span>
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
