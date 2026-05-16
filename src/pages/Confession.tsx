import { useEffect, useRef, useState } from "react";
import { Flame, Wind, Eraser } from "lucide-react";
import { cn, useDocumentTitle } from "../lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import PageHeader from "../components/PageHeader";
import { useMobileViewport } from "../context/MobileViewportContext";

export default function Confession() {
  useDocumentTitle("Confess | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const [confession, setConfession] = useState("");
  const [isReleasing, setIsReleasing] = useState(false);
  const [timeLeft, setTimeLeft] = useState(10);
  const [isDone, setIsDone] = useState(false);
  const timeoutsRef = useRef<number[]>([]);
  const prefersReducedMotion = useReducedMotion();

  const addTimeout = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
    return id;
  };

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(window.clearTimeout);
      timeoutsRef.current = [];
    };
  }, []);

  useEffect(() => {
    let timer: number | null = null;
    const burnDuration = prefersReducedMotion ? 1 : 10;

    if (isReleasing && timeLeft > 0) {
      timer = window.setTimeout(
        () => setTimeLeft((prev) => prev - 1),
        prefersReducedMotion ? 100 : 1000,
      );
    } else if (isReleasing && timeLeft === 0) {
      setIsDone(true);
      setIsReleasing(false);
      addTimeout(() => {
        setConfession("");
        addTimeout(() => {
          setIsDone(false);
          setTimeLeft(burnDuration);
        }, prefersReducedMotion ? 1500 : 5000);
      }, prefersReducedMotion ? 200 : 1000);
    }

    return () => {
      if (timer) window.clearTimeout(timer);
    };
  }, [isReleasing, prefersReducedMotion, timeLeft]);

  const handleRelease = () => {
    if (!confession.trim()) return;
    setTimeLeft(prefersReducedMotion ? 1 : 10);
    setIsReleasing(true);
  };

  const hasContent = confession.trim().length > 0;
  const panelHeight = isShortPhone ? "min(38vh, 15rem)" : "min(46vh, 18rem)";

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 sm:px-6",
        isCompactPhone && "px-3 pb-5 pt-2",
      )}
    >
      <PageHeader
        eyebrow="Unburden"
        title="Let it go"
        description="Write down what feels heavy. When you are ready, release it and let it disappear."
        className={cn("relative z-40", isShortPhone ? "mb-5" : "mb-6 sm:mb-10")}
      />

      <AnimatePresence mode="wait">
        {!isDone ? (
          <motion.div
            key="confession-box"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(10px)" }}
            transition={{ duration: prefersReducedMotion ? 0.15 : 0.5 }}
            className="flex flex-col gap-6 relative flex-1"
          >
            <motion.div
              className="app-panel group relative w-full overflow-hidden rounded-[2rem] border shadow-2xl transition-colors"
              style={{ height: panelHeight, minHeight: isShortPhone ? "13rem" : "15rem" }}
              animate={
                isReleasing && !prefersReducedMotion
                  ? {
                      scale: [1, 0.98, 0.95, 0.85],
                      rotate: [0, -0.5, 0.5, -1],
                      opacity: [1, 1, 0.8, 0],
                      filter: [
                        "brightness(1)",
                        "brightness(1.2) sepia(20%) saturate(120%)",
                        "brightness(0.6) sepia(80%) saturate(80%)",
                        "brightness(0) grayscale(100%)",
                      ],
                    }
                  : isReleasing && prefersReducedMotion
                    ? { opacity: [1, 0] }
                    : hasContent
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
                  ? { duration: prefersReducedMotion ? 0.6 : 8, ease: "easeIn" }
                  : { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
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
                  isCompactPhone ? "text-[16px] sm:p-6" : "text-[17px] sm:p-8",
                  isReleasing && "pointer-events-none opacity-80",
                )}
              />

              {hasContent && !isReleasing && (
                <span className="app-soft pointer-events-none absolute bottom-3 right-4 z-20 text-[11px] font-sans">
                  {confession.trim().length} characters
                </span>
              )}

              {isReleasing && !prefersReducedMotion && (
                <>
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: [0, 0.4, 0.2, 0.5, 0.3] }}
                    transition={{ duration: 4, ease: "easeInOut" }}
                    className="absolute inset-0 z-15 pointer-events-none"
                    style={{ backdropFilter: "blur(1px)", mixBlendMode: "overlay" }}
                  />
                  <motion.div
                    initial={{ top: "100%" }}
                    animate={{ top: "-10%" }}
                    transition={{ duration: 7, ease: "linear", delay: 0.5 }}
                    className="pointer-events-none absolute left-0 right-0 z-20 h-[120%]"
                    style={{
                      background:
                        "linear-gradient(0deg, var(--bg-base) 0%, color-mix(in srgb, var(--bg-base) 90%, transparent) 45%, transparent 100%)",
                    }}
                  />
                  <motion.div
                    initial={{ top: "100%" }}
                    animate={{ top: "-10%" }}
                    transition={{ duration: 7, ease: "linear", delay: 0.5 }}
                    className="pointer-events-none absolute left-0 right-0 z-20 h-[80px] mix-blend-color-dodge blur-sm"
                    style={{
                      background:
                        "linear-gradient(0deg, transparent 0%, color-mix(in srgb, var(--app-accent) 72%, transparent) 55%, transparent 100%)",
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
                isCompactPhone ? "py-4" : "py-5",
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
          </motion.div>
        ) : (
          <motion.div
            key="success-message"
            initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.8, filter: "blur(5px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: prefersReducedMotion ? 0.15 : 1, delay: prefersReducedMotion ? 0 : 0.2 }}
            className={cn("flex flex-1 flex-col items-center justify-center", isShortPhone ? "" : "-mt-16")}
          >
            <div className="relative mb-8">
              <motion.div
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1], opacity: [0.3, 0.1, 0.3] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full blur-md"
                style={{ background: "var(--app-accent-soft)" }}
              />
              <motion.div
                animate={prefersReducedMotion ? undefined : { y: [0, -10, 0] }}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
