import { useEffect, useMemo, useRef, useState } from "react";
import { Wind, Settings2, Plus, Minus, Pause, Play, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import PageHeader from "../components/PageHeader";
import { useDocumentTitle } from "../lib/utils";

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
  const [phase, setPhase] = useState<Phase>("Inhale");
  const [circleScale, setCircleScale] = useState(1);
  const [showSettings, setShowSettings] = useState(false);
  const [timings, setTimings] = useState<Timings>({ inhale: 4, hold: 4, exhale: 4 });
  const [isPaused, setIsPaused] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(timings.inhale);
  const timeoutRef = useRef<number | null>(null);

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
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (isPaused) return;

    timeoutRef.current = window.setTimeout(() => {
      setSecondsLeft((prev) => {
        if (prev > 1) return prev - 1;

        const nextPhase = PHASE_ORDER[(PHASE_ORDER.indexOf(phase) + 1) % PHASE_ORDER.length];
        setPhase(nextPhase);
        return timings[PHASE_LABELS[nextPhase]];
      });
    }, 1000);

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, [isPaused, phase, secondsLeft, timings]);

  const paceSummary = useMemo(
    () => `${timings.inhale}-${timings.hold}-${timings.exhale} rhythm`,
    [timings],
  );
  const centerScale = 1 + (circleScale - 1) * 0.22;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-6 pt-4 sm:px-8 sm:pb-8">
      <PageHeader
        align="center"
        eyebrow="Guided Stillness"
        title="Find your peace."
        description={`A ${cycleLength}-second breathing cycle with a ${paceSummary}.`}
        className="mb-3 shrink-0 sm:mb-8"
      />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
        <div className="relative mb-4 flex h-64 w-full max-w-[19rem] flex-shrink-0 items-center justify-center sm:mb-8 sm:h-72 sm:max-w-[22rem]">
          <div
            className="absolute h-40 w-40 rounded-full sm:h-44 sm:w-44"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--app-accent) 18%, transparent) 0%, color-mix(in srgb, var(--app-accent) 9%, transparent) 48%, transparent 72%)",
              transform: `scale(${circleScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
            }}
          />
          <div
            className="absolute h-32 w-32 rounded-full border sm:h-36 sm:w-36"
            style={{
              borderColor: "color-mix(in srgb, var(--app-accent) 18%, transparent)",
              boxShadow: "0 0 34px color-mix(in srgb, var(--app-accent) 18%, transparent)",
              transform: `scale(${circleScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
            }}
          />
          <div
            className="absolute h-28 w-28 rounded-full border backdrop-blur-xl sm:h-32 sm:w-32"
            style={{
              background: "color-mix(in srgb, var(--app-card-bg) 54%, transparent)",
              borderColor: "color-mix(in srgb, var(--app-accent) 35%, transparent)",
              boxShadow:
                "inset 0 0 24px color-mix(in srgb, var(--app-accent) 12%, transparent), 0 0 24px color-mix(in srgb, var(--app-accent) 16%, transparent)",
              transform: `scale(${centerScale})`,
              transition: `transform ${phaseDuration}ms ease-in-out`,
            }}
          />
          <div className="relative z-10 flex flex-col items-center gap-3 text-center">
            <Wind
              strokeWidth={1.5}
              className="h-10 w-10 opacity-90"
              style={{ color: "var(--app-accent)", filter: "drop-shadow(0 0 12px color-mix(in srgb, var(--app-accent) 40%, transparent))" }}
            />
            <span className="app-heading text-2xl font-light uppercase tracking-[0.15em] drop-shadow-md">
              {phase}
            </span>
            <span className="app-soft text-[11px] font-sans tabular-nums">
              {secondsLeft}s left
            </span>
          </div>
        </div>

        <div className="mb-4 flex w-full max-w-[340px] items-center justify-center gap-2 sm:mb-6">
          <button
            type="button"
            onClick={() => setIsPaused((prev) => !prev)}
            className="app-secondary-button inline-flex flex-shrink-0 items-center gap-2 rounded-pill px-3 py-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:px-4 sm:py-3 sm:text-sm"
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
            className="app-ghost-button inline-flex flex-shrink-0 items-center gap-1.5 rounded-pill px-3 py-2.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] sm:gap-2 sm:text-[12px]"
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
              id="breathing-customizer"
              role="dialog"
              aria-modal="true"
              aria-labelledby="breathing-customizer-title"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 24, scale: 0.98 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="app-panel absolute inset-x-4 bottom-4 z-30 rounded-card p-4 shadow-2xl sm:inset-x-8"
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
