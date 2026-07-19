import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Check } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { AppLogo } from "../components/AppLogo";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";
import { storageGetJson, storageRemove, storageSet } from "../lib/webStorage";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

const STORAGE_KEY = "bible_nova_companion_onboarding_answers";

const questions = [
  {
    id: "reason",
    title: "What brings you here today?",
    options: [
      { id: "stress", label: "Managing stress and anxiety", icon: <Brain className="w-5 h-5" /> },
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
      { id: "practical", label: "Simple practical steps", icon: <Sparkles className="w-5 h-5" /> },
    ],
  },
];

const getAnalysisSummary = (answers: Record<string, string>) => {
  const reasonById = {
    stress: "stress and anxiety feel heavy right now",
    purpose: "you are looking for clearer purpose and direction",
    healing: "emotional healing is a priority for you",
    faith: "reconnecting with your faith matters to you",
  } as const;

  const goalById = {
    peace: "find more inner peace",
    strength: "build stronger resilience",
    forgiveness: "move toward forgiveness",
    understanding: "understand yourself more honestly",
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
    overview: `You are here because ${reason}. Your focus is to ${goal}, with ${support}.`,
    appResponse: `Bible Nova Companion will meet you with ${supportAction}, scripture-based reflection, and one clear next step.`,
  };
};

export default function Onboarding() {
  useDocumentTitle("Welcome | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const shouldTopAlign = isShortPhone;
  const prefersReducedMotion = useReducedMotion();
  const isPerformanceMode = Boolean(
    prefersReducedMotion || (isNativePlatform() && getNativePlatform() === "android"),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    storageGetJson<Record<string, string>>(STORAGE_KEY, {}),
  );
  const [hasStarted, setHasStarted] = useState(() => Object.keys(answers).length > 0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const { completeOnboarding, updateShadowNotes } = useAuth();
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
    storageSet(STORAGE_KEY, JSON.stringify(answers));
  }, [answers]);

  const handleSelect = (optionId: string) => {
    const question = questions[currentStep];
    setAnswers((currentAnswers) => ({ ...currentAnswers, [question.id]: optionId }));
  };

  const handleContinue = () => {
    if (!answers[questions[currentStep].id]) return;
    if (currentStep < questions.length - 1) {
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
    setCurrentStep((prev) => prev - 1);
  };

  const handleGetStarted = () => {
    storageRemove(STORAGE_KEY);
    completeOnboarding();
    const analysis = getAnalysisSummary(answers);
    void updateShadowNotes(analysis.overview);
    window.requestAnimationFrame(() => navigate("/", { replace: true }));
  };

  if (!hasStarted) {
    return (
      <div className="app-screen-scroll sanctuary-screen relative flex w-full flex-col px-4 py-6">
        <div className="sanctuary-atmosphere" />
        <motion.main
          initial={isPerformanceMode ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: isPerformanceMode ? 0 : 0.3, ease: "easeOut" }}
          className="sanctuary-surface relative z-10 mx-auto my-auto w-full max-w-md rounded-[1.35rem] px-6 py-8 text-center sm:px-8 sm:py-10"
        >
          <div className="sanctuary-brand-mark mx-auto mb-6 h-20 w-20">
            <AppLogo className="h-full w-full object-cover" />
          </div>
          <p className="app-kicker mb-3">A gentler beginning</p>
          <h1 className="app-heading font-serif text-[2.35rem] leading-[1.12] sm:text-[2.65rem]">
            A reflection space shaped around you.
          </h1>
          <p className="app-muted mx-auto mt-4 max-w-sm text-[15px] leading-7">
            Answer three thoughtful questions so Bible Nova can meet you with the right tone, scripture, and next step.
          </p>
          <div className="sanctuary-preview my-7 rounded-[1.35rem] px-5 py-4 text-left">
            <p className="app-kicker mb-2 text-[9px]">Your daily moment</p>
            <p className="scripture-copy app-heading text-xl leading-snug">Pause. Name what you’re carrying. Receive one clear place to begin.</p>
          </div>
          <button
            type="button"
            onClick={() => setHasStarted(true)}
            className="touch-target app-primary-button flex w-full items-center justify-center gap-2 rounded-[1rem] py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Personalize my space
            <Sparkles className="h-4.5 w-4.5" />
          </button>
          <p className="app-muted mt-4 text-[11px] leading-relaxed">Your answers are used only to personalize your experience.</p>
        </motion.main>
      </div>
    );
  }

  if (showAnalysis) {
    const analysis = getAnalysisSummary(answers);

    return (
      <div
        className="app-screen-scroll sanctuary-screen w-full relative flex flex-col items-center justify-start px-4 py-5 scrollbar-hide"
      >
        <div className="sanctuary-atmosphere" />

        <motion.div
          initial={isPerformanceMode ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: isPerformanceMode ? 0 : 0.22, ease: "easeOut" }}
          className={cn(
            "sanctuary-surface shrink-0 relative z-10 w-full max-w-md rounded-[1.35rem]",
            !shouldTopAlign && "my-auto",
            isCompactPhone ? "p-5" : "p-6 sm:p-8",
          )}
        >
          <button
            onClick={handleBack}
            className="app-ghost-button mb-6 inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="mb-6 text-center">
            <p className="app-kicker mb-3">A space made for you</p>
            <h2 className={cn("app-heading mb-4 pb-1 font-serif leading-[1.18]", isCompactPhone ? "text-[2rem]" : "text-[2.25rem]")}>
              Your reflection space is ready.
            </h2>
            <p className="app-muted mx-auto max-w-sm text-[15px] leading-relaxed">
              {analysis.overview}
            </p>
          </div>

          <div className={cn("space-y-4", isShortPhone ? "mb-5" : "mb-7")}>
            <div className="sanctuary-preview rounded-[1.35rem] px-5 py-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="app-kicker text-[9px]">A glimpse of your space</p>
                <span className="app-accent-badge rounded-pill px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.15em]">Personalized</span>
              </div>
              <p className="scripture-copy app-heading text-[1.4rem] leading-snug">“Be still, and know that I am God.”</p>
              <p className="app-accent mt-1 text-[11px] font-semibold uppercase tracking-[0.14em]">Psalm 46:10</p>
              <div className="app-divider my-4 border-t" />
              <p className="app-muted text-sm leading-relaxed">Begin by naming the one thing that feels heaviest today. You do not need to solve it all at once.</p>
            </div>

            <div className="sanctuary-note">
              <div className="mb-2 flex items-center gap-2.5">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full" style={{ background: "color-mix(in srgb, var(--app-accent) 16%, transparent)", color: "var(--app-accent)" }}>
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                </span>
                <p className="app-kicker text-[10px]">Your next gentle step</p>
              </div>
              <p className="app-heading text-sm leading-relaxed">{analysis.appResponse}</p>
            </div>
          </div>

          <button
            onClick={handleGetStarted}
            className="touch-target app-primary-button flex w-full items-center justify-center rounded-[1rem] py-4 font-semibold text-white transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Begin my first reflection
          </button>
        </motion.div>
      </div>
    );
  }

  const question = questions[currentStep];
  const completedCount = questions.filter((item) => Boolean(answers[item.id])).length;

  return (
    <div
      className="app-screen-scroll sanctuary-screen w-full relative flex flex-col overflow-x-hidden px-4"
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "1.25rem" : "2rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "1.5rem" : "2.25rem"})`,
      }}
    >
      <div className="sanctuary-atmosphere" />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className={cn("flex items-center justify-between", isShortPhone ? "mb-5" : "mb-7")}>
          <button
            onClick={handleBack}
            className="touch-target app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={questions.length} aria-valuenow={completedCount} aria-label={`${completedCount} of ${questions.length} questions completed`}>
            {questions.map((item, index) => (
              <span key={item.id} className="h-1.5 w-6 rounded-full" style={{ background: index <= currentStep ? "var(--app-accent)" : "var(--app-card-border)" }} />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep}
            initial={isPerformanceMode ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={isPerformanceMode ? undefined : { opacity: 0 }}
            transition={{ duration: isPerformanceMode ? 0 : 0.12, ease: "linear" }}
            className="sanctuary-surface flex-1 shrink-0 rounded-[1.35rem] px-5 py-6 sm:px-7 sm:py-8"
          >
            <span className={cn("app-kicker text-xs font-semibold", isShortPhone ? "mb-3 inline-flex" : "mb-4 inline-flex")}>
              Question {currentStep + 1} of {questions.length}
            </span>
            <h1 className={cn("app-heading mb-4 pb-1 font-serif leading-[1.24]", isCompactPhone ? "text-[2rem]" : "text-3xl sm:text-4xl")}>
              {question.title}
            </h1>
            <p className={cn("app-muted max-w-sm", isShortPhone ? "mb-7" : "mb-10")}>
              Choose what feels most true right now. You can change your preferences later.
            </p>

            {currentStep === 0 && (
              <div className="sanctuary-trust mb-5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--app-success)" }} />
                <span>This helps personalize your reflections. You can update your preferences later.</span>
              </div>
            )}

            <div role="radiogroup" aria-label={question.title} className={cn(isCompactPhone ? "space-y-3" : "space-y-4")}>
              {question.options.map((option) => {
                const isSelected = answers[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleSelect(option.id)}
                    className={`touch-target sanctuary-option w-full rounded-[1rem] text-left flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] ${isCompactPhone ? "p-4" : "p-5"}`}
                  >
                    <div className="flex min-w-0 items-center gap-4">
                      {option.icon && (
                        <div
                          className="rounded-full p-2"
                          style={{
                            background: isSelected ? "color-mix(in srgb, var(--app-accent) 18%, transparent)" : "var(--app-card-soft)",
                            color: isSelected ? "var(--app-accent)" : "var(--app-text-muted)",
                          }}
                        >
                          {option.icon}
                        </div>
                      )}
                      <span
                        className={cn("min-w-0 leading-snug", isCompactPhone ? "text-[16px]" : "text-lg")}
                        style={{
                          color: isSelected ? "var(--app-accent)" : "var(--app-text)",
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                      {option.label}
                      </span>
                    </div>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: isSelected ? "var(--app-accent)" : "var(--app-card-border)", background: isSelected ? "var(--app-accent)" : "transparent" }}>
                      {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="sanctuary-sticky-action mt-6">
              <button
                type="button"
                onClick={handleContinue}
                disabled={!answers[question.id]}
                className="touch-target app-primary-button flex w-full items-center justify-center gap-2 rounded-[1rem] py-4 font-semibold disabled:cursor-not-allowed disabled:opacity-45 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                {currentStep === questions.length - 1 ? "See my reflection space" : "Continue"}
                <Sparkles className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
