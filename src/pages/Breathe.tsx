import { useEffect, useMemo, useRef, useState } from "react";
import { Wind, Settings2, Plus, Minus, Pause, Play, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import PageHeader from "../components/PageHeader";
import { useDocumentTitle, cn } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

type Phase = "Inhale" | "Hold" | "Exhale";
type Timings = { inhale: number; hold: number; exhale: number };

const MIN = 2;
const MAX = 12;
const clamp = (value: number) => Math.max(MIN, Math.min(MAX, value));

const PHASE_LABELS: Record<Phase, keyof Timings> = {
  Inhale: "inhale",
  Hold: "hold",
  Exhale: "exhale",
};

const PHASE_ORDER: Phase[] = ["Inhale", "Hold", "Exhale"];

export default function Breathe() {
  useDocumentTitle("Breathe | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const isAndroidApp = isNativePlatform() && getNativePlatform() === "android";
  const [phase, setPhase] = useState<Phase>("Inhale");
  const [circleScale, setCircleScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [timings, setTimings] = useState<Timings>({ inhale: 4, hold: 4, exhale: 4 });
  const [isPaused, setIsPaused] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [sessionDuration, setSessionDuration] = useState(60);
  const [sessionLeft, setSessionLeft] = useState(60);
  const [secondsLeft, setSecondsLeft] = useState(timings.inhale);
  const customizerRef = useRef<HTMLDivElement>(null);
  const customizerTriggerRef = useRef<HTMLButtonElement>(null);

  const phaseDuration = timings[PHASE_LABELS[phase]] * 1000;
  const cycleLength = timings.inhale + timings.hold + timings.exhale;

  const adjust = (key: keyof Timings, delta: number) => {
    setTimings((prev) => {
      const next = { ...prev, [key]: clamp(prev[key] + delta) };
      if (PHASE_LABELS[phase] === key) {
        setSecondsLeft(next[key]);
      }
      return next;
    });
  };

  useEffect(() => {
    if (phase === "Inhale") setCircleScale(1.58);
    if (phase === "Hold") setCircleScale(1.58);
    if (phase === "Exhale") setCircleScale(1);
    setSecondsLeft(timings[PHASE_LABELS[phase]]);
  }, [phase, timings]);

  useEffect(() => {
    if (!isStarted || isPaused) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((remaining) => {
        if (remaining > 1) return remaining - 1;
        const nextPhase = PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length];
        setPhase(nextPhase);
        return timings[PHASE_LABELS[nextPhase]];
      });
      setSessionLeft((remaining) => {
        if (remaining <= 1) {
          setIsStarted(false);
          setIsPaused(false);
          return sessionDuration;
        }
        return remaining - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPaused, isStarted, phase, sessionDuration, timings]);

  useEffect(() => {
    if (!showSettings) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.requestAnimationFrame(() => customizerRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSettings(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      (customizerTriggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [showSettings]);

  const paceSummary = useMemo(
    () => `${timings.inhale}-${timings.hold}-${timings.exhale} rhythm`,
    [timings],
  );
  const centerScale = 1 + (circleScale - 1) * 0.22;
  const visualSize = isShortPhone ? "15.5rem" : isCompactPhone ? "16.5rem" : "19rem";
  const innerGlowSize = isShortPhone ? "8rem" : "10rem";
  const innerRingSize = isShortPhone ? "6.25rem" : "8rem";

  return (
    <div
      className={cn(
        "app-scroll-region relative flex min-h-0 flex-1 flex-col px-4 pb-6 pt-3 sm:px-8 sm:pb-8 sm:pt-4",
        isCompactPhone && "px-3 pb-5 pt-2",
      )}
    >
      <PageHeader
        align="center"
        eyebrow="Guided Stillness"
        title="Find your peace."
        description={`A ${cycleLength}-second breathing cycle with a ${paceSummary}.`}
        className={cn("shrink-0", isShortPhone ? "mb-2.5" : "mb-3 sm:mb-8")}
      />

      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center",
          isShortPhone ? "justify-start" : "justify-center",
        )}
      >
        {!isStarted && (
          <div className="app-panel mb-5 w-full max-w-sm rounded-card p-4 text-center">
            <p className="app-heading font-semibold">Choose a quiet moment</p>
            <div className="my-4 flex justify-center gap-2" role="radiogroup" aria-label="Breathing duration">
              {[60, 180, 300].map((duration) => <button key={duration} role="radio" aria-checked={sessionDuration === duration} onClick={() => { setSessionDuration(duration); setSessionLeft(duration); }} className={cn("touch-target rounded-pill px-4 py-2 text-sm", sessionDuration === duration ? "app-primary-button text-white" : "app-secondary-button")}>{duration / 60} min</button>)}
            </div>
            <button onClick={() => { setSessionLeft(sessionDuration); setIsStarted(true); }} className="touch-target app-primary-button w-full rounded-pill py-3 font-semibold text-white">Begin breathing</button>
          </div>
        )}
        <div
          className={cn(
            "relative flex w-full flex-shrink-0 items-center justify-center",
            isShortPhone ? "mb-3 h-56" : "mb-4 h-64 sm:mb-8 sm:h-72",
          )}
          style={{ maxWidth: visualSize }}
        >
          {/* Ambient outer halo */}
          {!isAndroidApp && (
            <div
              className="absolute rounded-full"
              style={{
                background:
                  "radial-gradient(circle, color-mix(in srgb, var(--app-accent) 10%, transparent) 0%, transparent 72%)",
                height: isShortPhone ? "13rem" : isCompactPhone ? "14rem" : "16.5rem",
                width: isShortPhone ? "13rem" : isCompactPhone ? "14rem" : "16.5rem",
                transform: `scale(${circleScale * 0.9 + 0.1})`,
                transition: `transform ${phaseDuration * 1.2}ms ease-in-out`,
              }}
            />
          )}
          <div
            className="absolute rounded-full"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--app-accent) 18%, transparent) 0%, color-mix(in srgb, var(--app-accent) 9%, transparent) 48%, transparent 72%)",
              height: innerGlowSize,
              transform: `scale(${circleScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
              width: innerGlowSize,
            }}
          />
          {/* Second outer ring — slightly slower */}
          {!isAndroidApp && (
            <div
              className="absolute rounded-full border"
              style={{
                borderColor: "color-mix(in srgb, var(--app-accent) 10%, transparent)",
                height: isShortPhone ? "10rem" : "12rem",
                width: isShortPhone ? "10rem" : "12rem",
                transform: `scale(${circleScale})`,
                transition: `transform ${phaseDuration * 1.15}ms ease-in-out`,
              }}
            />
          )}
          <div
            className="absolute rounded-full border"
            style={{
              borderColor: "color-mix(in srgb, var(--app-accent) 18%, transparent)",
              boxShadow: "0 0 34px color-mix(in srgb, var(--app-accent) 18%, transparent)",
              height: innerRingSize,
              transform: `scale(${circleScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
              width: innerRingSize,
            }}
          />
          <div
            className="absolute rounded-full border"
            style={{
              background: "color-mix(in srgb, var(--app-card-bg) 54%, transparent)",
              borderColor: "color-mix(in srgb, var(--app-accent) 40%, transparent)",
              boxShadow:
                "inset 0 0 24px color-mix(in srgb, var(--app-accent) 14%, transparent), 0 0 32px color-mix(in srgb, var(--app-accent) 20%, transparent)",
              height: isShortPhone ? "5.4rem" : "7rem",
              transform: `scale(${centerScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
              width: isShortPhone ? "5.4rem" : "7rem",
            }}
          />
          <div className="relative z-10 flex flex-col items-center gap-3 text-center">
            <Wind
              strokeWidth={1.5}
              className="h-10 w-10 opacity-90"
              style={{ color: "var(--app-accent)", filter: "drop-shadow(0 0 14px color-mix(in srgb, var(--app-accent) 50%, transparent))" }}
            />
            <span className="app-heading text-2xl font-light uppercase tracking-[0.15em] drop-shadow-md">
              {isStarted ? phase : "Ready"}
            </span>
            <span className="app-soft text-[11px] font-sans tabular-nums">
              {isStarted ? `${secondsLeft}s · ${Math.ceil(sessionLeft / 60)} min left` : paceSummary}
            </span>
          </div>
        </div>

        <div className={cn("mb-4 flex w-full items-center justify-center gap-2", isShortPhone ? "max-w-[320px]" : "max-w-[340px] sm:mb-6")}>
          <button
            ref={customizerTriggerRef}
            type="button"
            onClick={() => setIsPaused((prev) => !prev)}
            disabled={!isStarted}
            className="touch-target app-secondary-button inline-flex flex-shrink-0 items-center gap-2 rounded-pill px-3 py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:px-4 sm:py-3 sm:text-sm"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {isPaused ? "Resume" : "Pause"}
          </button>
          <div className="app-soft min-w-0 flex-1 text-center text-[10px] uppercase leading-tight tracking-[0.14em] sm:text-xs sm:tracking-[0.18em]">
            {paceSummary}
          </div>
          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            aria-controls="breathing-customizer"
            aria-expanded={showSettings}
            className="touch-target app-ghost-button inline-flex flex-shrink-0 items-center gap-1.5 rounded-pill px-3 py-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:gap-2 sm:text-[12px]"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {showSettings ? "Done" : "Customize"}
          </button>
        </div>

        <p className="app-muted mb-4 max-w-[300px] text-center text-base italic leading-relaxed font-serif sm:mb-6 sm:text-lg">
          "Be still, and know that I am God."
          <span className="app-kicker mt-3 block text-[11px] not-italic">
            Psalm 46:10
          </span>
        </p>
      </div>

      <AnimatePresence>
        {showSettings && (
          <>
            <motion.button
              type="button"
              aria-label="Close breathing customizer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setShowSettings(false)}
              className="app-overlay absolute inset-0 z-20 cursor-default backdrop-blur-[2px]"
            />

            <motion.div
              ref={customizerRef}
              tabIndex={-1}
              id="breathing-customizer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="breathing-customizer-title"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="app-panel absolute inset-x-4 bottom-4 z-30 rounded-card p-4 shadow-2xl sm:inset-x-8"
              style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
            >
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="app-kicker" id="breathing-customizer-title">
                    Custom rhythm
                  </p>
                  <p className="app-muted mt-1 text-[12px]">
                    Set each phase from {MIN}s to {MAX}s.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSettings(false)}
                  className="app-secondary-button flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                  aria-label="Close breathing customizer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2">
                {(["Inhale", "Hold", "Exhale"] as Phase[]).map((label) => {
                  const key = PHASE_LABELS[label];
                  const isActive = phase === label;
                  return (
                    <div key={label} className="flex items-center justify-between gap-3 rounded-2xl px-1 py-1">
                      <span
                        className="w-16 text-[13px] font-medium transition-colors"
                        style={{ color: isActive ? "var(--app-accent)" : "var(--app-text-muted)" }}
                      >
                        {label}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => adjust(key, -1)}
                          disabled={timings[key] <= MIN}
                          aria-label={`Decrease ${label.toLowerCase()} duration`}
                          className="app-secondary-button flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:opacity-30"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="app-heading w-8 text-center text-[15px] font-semibold tabular-nums">
                          {timings[key]}s
                        </span>
                        <button
                          type="button"
                          onClick={() => adjust(key, 1)}
                          disabled={timings[key] >= MAX}
                          aria-label={`Increase ${label.toLowerCase()} duration`}
                          className="app-secondary-button flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:opacity-30"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
