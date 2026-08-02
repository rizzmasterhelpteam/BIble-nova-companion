import React, { useEffect, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Check, BookOpen, ChevronRight, Wind } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";
import { clearOnboardingDraft, loadOnboardingDraft, saveOnboardingDraft } from "../lib/onboardingDraft";

const questions = [
  {
    id: "reason",
    title: "What brings you here today?",
    options: [
      { id: "stress", label: "Managing stress and anxiety", icon: <Wind className="w-5 h-5" /> },
      { id: "purpose", label: "Seeking purpose and clarity", icon: <Sparkles className="w-5 h-5" /> },
      { id: "healing", label: "Emotional healing", icon: <Heart className="w-5 h-5" /> },
      { id: "faith", label: "Reconnecting with faith", icon: <ChristianCross className="w-5 h-5" /> },
    ],
  },
  {
    id: "goal",
    title: "What is your primary goal?",
    options: [
      { id: "peace", label: "Find inner peace" },
      { id: "strength", label: "Build resilience" },
      { id: "forgiveness", label: "Learn to forgive" },
      { id: "understanding", label: "Understand myself better" },
    ],
  },
  {
    id: "support",
    title: "What kind of guidance feels most helpful?",
    options: [
      { id: "gentle", label: "Gentle comfort", icon: <Heart className="w-5 h-5" /> },
      { id: "honest", label: "Honest moral clarity", icon: <ShieldCheck className="w-5 h-5" /> },
      { id: "prayer", label: "Prayer and scripture", icon: <ChristianCross className="w-5 h-5" /> },
      { id: "practical", label: "Simple practical steps", icon: <Brain className="w-5 h-5" /> },
    ],
  },
];

const getAnalysisSummary = (answers: Record<string, string>) => {
  const reasonById = {
    stress: "stress and anxiety",
    purpose: "purpose and clarity",
    healing: "emotional healing",
    faith: "reconnecting with faith",
  } as const;

  const goalById = {
    peace: "more inner peace",
    strength: "stronger resilience",
    forgiveness: "forgiveness",
    understanding: "understanding yourself more honestly",
  } as const;

  const supportById = {
    gentle: "gentle comfort",
    honest: "honest moral clarity",
    prayer: "prayer and scripture",
    practical: "simple practical steps",
  } as const;

  const supportActionById = {
    gentle: "a calm and reassuring tone",
    honest: "clear moral guidance rooted in scripture",
    prayer: "prayerful guidance and scripture-based reflection",
    practical: "clear next steps you can act on right away",
  } as const;

  const reason = reasonById[answers.reason as keyof typeof reasonById] ?? "you are looking for thoughtful spiritual support";
  const goal = goalById[answers.goal as keyof typeof goalById] ?? "feel more grounded";
  const support = supportById[answers.support as keyof typeof supportById] ?? "steady spiritual guidance";
  const supportAction = supportActionById[answers.support as keyof typeof supportActionById] ?? "steady spiritual guidance with practical next steps";

  return {
    overview: `Based on your answers, you may want support with ${reason}, ${goal}, and ${support}.`,
    appResponse: `Bible Nova Companion will meet you with ${supportAction}, scripture-based reflection, and one clear next step.`,
  };
};

// Defined outside component to avoid re-creating on every render
const BackgroundOrbs = memo(({ animated = true }: { animated?: boolean }) => {
  if (!animated) return null;

  return (
    <>
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.25, 0.4, 0.25], x: [0, 30, 0], y: [0, -40, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="pointer-events-none absolute -top-[10%] -left-[10%] h-[500px] w-[500px] rounded-full"
        style={{ background: "var(--app-orb-a)", filter: "blur(100px)" }}
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.28, 0.15], x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 2 }}
        className="pointer-events-none absolute top-[50%] -right-[10%] h-[600px] w-[600px] rounded-full"
        style={{ background: "var(--app-orb-b)", filter: "blur(120px)" }}
      />
    </>
  );
});
BackgroundOrbs.displayName = "BackgroundOrbs";

export default function Onboarding() {
  useDocumentTitle("Welcome | Bible Nova Companion");
  const { isCompactPhone, isShortPhone: viewportShortPhone, visibleHeight, width } = useMobileViewport();
  const isShortPhone = viewportShortPhone || (isCompactPhone && visibleHeight <= 840);
  const prefersReducedMotion = useReducedMotion();
  const isPerformanceMode = Boolean(
    prefersReducedMotion || (isNativePlatform() && getNativePlatform() === "android"),
  );
  const disableAmbientMotion = Boolean(
    isPerformanceMode ||
      (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches),
  );
  const shouldAnimateLightly = !isPerformanceMode;
  const { user, completeOnboarding, enableMemoryWithInitialNotes } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [prevStep, setPrevStep] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, string>>(() => user?.id ? loadOnboardingDraft(user.id) : {});
  const [rememberPreferences, setRememberPreferences] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [hasStarted, setHasStarted] = useState(() => Object.keys(answers).length > 0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const initialStep = questions.findIndex((question) => !answers[question.id]);
    if (initialStep === -1) {
      setCurrentStep(questions.length - 1);
      setShowAnalysis(true);
      return;
    }
    setCurrentStep(initialStep);
  }, []);

  useEffect(() => {
    if (user?.id) saveOnboardingDraft(user.id, answers);
  }, [answers, user?.id]);

  const handleSelect = (optionId: string) => {
    const question = questions[currentStep];
    setAnswers((currentAnswers) => ({ ...currentAnswers, [question.id]: optionId }));
  };

  const handleContinue = () => {
    const currentAnswer = answers[questions[currentStep].id];
    if (!currentAnswer) return;
    if (currentStep < questions.length - 1) {
      setPrevStep(currentStep);
      setCurrentStep((prev) => Math.min(prev + 1, questions.length - 1));
      return;
    }
    setShowAnalysis(true);
  };

  const handleBack = () => {
    if (showAnalysis) {
      setShowAnalysis(false);
      setCurrentStep(questions.length - 1);
      return;
    }
    if (currentStep === 0) {
      setHasStarted(false);
      return;
    }
    setPrevStep(currentStep);
    setCurrentStep((prev) => prev - 1);
  };

  const handleGetStarted = async () => {
    setCompletionError(null);
    try {
      if (rememberPreferences) await enableMemoryWithInitialNotes(getAnalysisSummary(answers).overview);
      if (user?.id) clearOnboardingDraft(user.id);
      completeOnboarding();
      window.requestAnimationFrame(() => navigate("/", { replace: true }));
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "Could not save your memory choice.");
    }
  };

  const handleSkip = () => {
    if (user?.id) clearOnboardingDraft(user.id);
    completeOnboarding();
    navigate("/", { replace: true });
  };

  // Staggered welcome screen
  if (!hasStarted) {
    const makeStagger = (delay: number) =>
      isPerformanceMode
        ? {}
        : {
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay },
          };

    return (
      <div
        className="onboarding-screen app-screen-scroll relative w-full items-center justify-center px-5 pb-8"
        style={{
          paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "2rem" : "3rem"})`,
        }}
      >
        <BackgroundOrbs animated={!disableAmbientMotion} />
        
        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
          <motion.div
            {...makeStagger(0.2)}
            className="onboarding-surface inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 mb-5"
          >
            <Sparkles className="app-accent w-3.5 h-3.5" />
            <span className="app-muted text-xs font-semibold tracking-wider uppercase">Welcome to Bible Nova</span>
          </motion.div>
          
          <motion.h1
            className="app-heading font-serif text-4xl sm:text-5xl leading-tight mb-4 tracking-tight"
            {...makeStagger(0.3)}
          >
            A quieter place to return to.
          </motion.h1>
          
          <motion.p
            className="app-muted text-[15px] sm:text-[16px] leading-relaxed max-w-sm mb-8"
            {...makeStagger(0.4)}
          >
            Answer three thoughtful questions to shape your personalized reflection space.
          </motion.p>

          {/* CTA */}
          <motion.div className="w-full" {...makeStagger(0.5)}>
            <button
              onClick={() => setHasStarted(true)}
              className="app-primary-button touch-target relative w-full overflow-hidden group rounded-[1.25rem] py-4 flex items-center justify-center gap-2 font-bold text-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none" />
              Begin Your Journey
              <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>

          <button
            type="button"
            onClick={handleSkip}
            className="touch-target app-ghost-button mt-3 rounded-pill px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Use defaults for now
          </button>
          
          <motion.div className="onboarding-trust mt-5 flex items-center justify-center gap-2 border-t pt-3" {...makeStagger(0.6)}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="text-xs">Your answers shape this space and stay with your account.</span>
          </motion.div>
        </div>
      </div>
    );
  }

  if (showAnalysis) {
    const analysis = getAnalysisSummary(answers);

    return (
      <div
        className="onboarding-screen app-screen-scroll relative w-full items-center justify-start px-4 pb-8"
        style={{
          paddingTop: "max(env(safe-area-inset-top, 0px), 3rem)",
        }}
      >
        <BackgroundOrbs animated={!disableAmbientMotion} />

        <motion.div
          initial={shouldAnimateLightly ? { opacity: 0, y: 10 } : false}
          animate={shouldAnimateLightly ? { opacity: 1, y: 0 } : undefined}
          transition={shouldAnimateLightly ? { duration: 0.22, ease: [0.22, 1, 0.36, 1] } : undefined}
          className="relative z-10 w-full max-w-md flex flex-col py-2"
        >
          <button
            onClick={handleBack}
            className="touch-target app-secondary-button self-start inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium mb-8 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="text-center mb-8">
            <span className="app-accent-badge inline-flex items-center justify-center w-14 h-14 rounded-full mb-4">
              <Check className="w-7 h-7" strokeWidth={2.5} />
            </span>
            <h2 className="app-heading font-serif text-3xl sm:text-4xl leading-tight mb-3">
              Your space is ready.
            </h2>
            <p className="app-muted text-[15px] leading-relaxed max-w-sm mx-auto">
              {analysis.overview}
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {/* Scripture preview */}
            <motion.div
              className="sanctuary-preview relative overflow-hidden rounded-[1.5rem] p-6"
              initial={isPerformanceMode ? false : { opacity: 0, y: 16 }}
              animate={isPerformanceMode ? undefined : { opacity: 1, y: 0 }}
              transition={isPerformanceMode ? { duration: 0 } : { duration: 0.5, delay: 0.2 }}
            >
              <div className="absolute top-0 right-0 p-5 pointer-events-none" style={{ opacity: 0.05 }}>
                <BookOpen className="w-24 h-24 rotate-12" />
              </div>
              <div className="flex items-center justify-between mb-4 relative z-10">
                <span className="app-soft text-[10px] uppercase tracking-widest font-semibold">Glimpse</span>
                <span className="app-accent-badge rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider">Personalized</span>
              </div>
              <p className="app-heading font-serif text-[1.5rem] leading-snug mb-2 relative z-10">"Be still, and know that I am God."</p>
              <p className="app-kicker text-[11px] font-bold uppercase tracking-widest relative z-10">Psalm 46:10</p>
            </motion.div>

          </div>

          <motion.button
            onClick={handleGetStarted}
            className="app-primary-button touch-target w-full font-bold text-lg rounded-[1.25rem] py-4 flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            initial={isPerformanceMode ? false : { opacity: 0, y: 16 }}
            animate={isPerformanceMode ? undefined : { opacity: 1, y: 0 }}
            transition={isPerformanceMode ? { duration: 0 } : { duration: 0.5, delay: 0.44 }}
            whileHover={isPerformanceMode ? undefined : { scale: 1.01, boxShadow: "var(--app-accent-shadow)" }}
            whileTap={isPerformanceMode ? undefined : { scale: 0.98 }}
          >
            Enter Bible Nova
          </motion.button>
          <label className="app-panel mt-4 flex items-start gap-3 rounded-2xl border p-4 text-left">
            <input
              type="checkbox"
              checked={rememberPreferences}
              onChange={(event) => setRememberPreferences(event.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span className="app-muted text-sm leading-relaxed">
              <strong className="app-heading block">Remember my preferences across conversations</strong>
              Optional. This stores a compact summary you can delete anytime in Settings.
            </span>
          </label>
          {completionError && <p className="mt-3 text-center text-sm text-red-600" role="alert">{completionError}</p>}
        </motion.div>
      </div>
    );
  }

  const question = questions[currentStep];
  // Fixed: progress shows filled steps correctly (step 1 = 33%, step 2 = 66%, step 3 = 100%)
  const progressPercent = ((currentStep + 1) / questions.length) * 100;

  const isGoingForward = prevStep < currentStep;
  const slideVariants = {
    initial: { opacity: 0, x: isGoingForward ? 24 : -24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: isGoingForward ? -24 : 24 },
  };

  const questionStep = (
    <motion.div
      key={currentStep}
      variants={shouldAnimateLightly ? slideVariants : undefined}
      initial={shouldAnimateLightly ? "initial" : false}
      animate={shouldAnimateLightly ? "animate" : undefined}
      exit={shouldAnimateLightly ? "exit" : undefined}
      transition={shouldAnimateLightly ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] } : undefined}
      className="w-full"
    >
      <h1
        className="app-heading font-serif text-3xl sm:text-4xl leading-tight mb-3 tracking-tight"
      >
        {question.title}
      </h1>
      <p className="app-muted text-[14px] mb-8">
        Choose what feels most true right now.
      </p>

      <div role="radiogroup" aria-label={question.title} className="space-y-3">
        {question.options.map((option, optIdx) => {
          const isSelected = answers[question.id] === option.id;
          return (
            <motion.button
              key={option.id}
              role="radio"
              aria-checked={isSelected}
              onClick={() => handleSelect(option.id)}
              whileHover={shouldAnimateLightly ? { scale: 1.02, y: -1 } : undefined}
              whileTap={shouldAnimateLightly ? { scale: 0.985 } : undefined}
              className="onboarding-choice touch-target w-full flex items-center justify-between p-4 sm:p-5 rounded-2xl text-left relative overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              initial={shouldAnimateLightly ? { opacity: 0, y: 16 } : false}
              animate={shouldAnimateLightly ? { opacity: 1, y: 0 } : undefined}
              transition={shouldAnimateLightly ? { duration: 0.26, delay: optIdx * 0.04 } : undefined}
            >
              {isSelected && (
                <motion.div
                  layoutId={shouldAnimateLightly ? "active-option-bg" : undefined}
                  className="absolute inset-0 pointer-events-none"
                  style={{ background: "linear-gradient(90deg, color-mix(in srgb, var(--app-accent) 8%, transparent), transparent)" }}
                />
              )}

              <div className="flex items-center gap-4 relative z-10">
                {option.icon && (
                  <div
                    className="p-2.5 rounded-xl transition-colors duration-300"
                    style={{
                      background: isSelected ? "var(--app-accent)" : "var(--app-card-soft)",
                      color: isSelected ? "var(--app-accent-contrast)" : "var(--app-text-muted)",
                    }}
                  >
                    {option.icon}
                  </div>
                )}
                <span
                  className="text-[15px] sm:text-[16px] transition-colors duration-300 font-medium"
                  style={{ color: isSelected ? "var(--app-accent)" : "var(--app-text)" }}
                >
                  {option.label}
                </span>
              </div>

              <div
                className="flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 w-6 h-6 relative z-10 ml-3"
                style={{
                  borderColor: isSelected ? "var(--app-accent)" : "var(--app-card-border)",
                  background: isSelected ? "var(--app-accent)" : "transparent",
                }}
              >
                {isSelected && (
                  <motion.div
                    initial={shouldAnimateLightly ? { scale: 0.5, opacity: 0 } : false}
                    animate={shouldAnimateLightly ? { scale: 1, opacity: 1 } : undefined}
                    transition={shouldAnimateLightly ? { duration: 0.16, ease: "easeOut" } : undefined}
                  >
                    <Check className="w-3.5 h-3.5" style={{ color: "var(--app-accent-contrast)" }} strokeWidth={3.5} />
                  </motion.div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={handleContinue}
        disabled={!answers[question.id]}
        className="app-primary-button touch-target mt-5 w-full rounded-pill py-3.5 text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
      >
        {currentStep === questions.length - 1 ? "Review my space" : "Continue"}
        <ChevronRight className="ml-1 inline-block h-4 w-4" />
      </button>
    </motion.div>
  );

  return (
    <div
      className="onboarding-screen app-screen-scroll relative w-full px-4 pb-8"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 3rem)",
      }}
    >
      <BackgroundOrbs animated={!disableAmbientMotion} />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Header: back + progress */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleBack}
            className="touch-target app-secondary-button inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 max-w-[160px] ml-4">
            <div className="onboarding-progress-track h-1.5 w-full rounded-full overflow-hidden">
              <motion.div
                className="onboarding-progress-fill h-full rounded-full"
                initial={isPerformanceMode ? false : { width: 0 }}
                animate={isPerformanceMode ? undefined : { width: `${progressPercent}%` }}
                transition={isPerformanceMode ? undefined : { duration: 0.45, ease: "easeOut" }}
                style={isPerformanceMode ? { width: `${progressPercent}%` } : undefined}
              />
            </div>
            <div className="text-right mt-1.5">
              <span className="app-soft text-[10px] font-semibold tracking-widest uppercase">
                Step {currentStep + 1} of {questions.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          {isPerformanceMode ? questionStep : (
            <AnimatePresence mode="wait" custom={isGoingForward}>
              {questionStep}
            </AnimatePresence>
          )}
        </div>

        <button
          type="button"
          onClick={handleSkip}
          className="touch-target app-ghost-button mx-auto mt-5 rounded-pill px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
