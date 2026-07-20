import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Check, BookOpen } from "lucide-react";
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
  const { isCompactPhone, isShortPhone: viewportShortPhone, visibleHeight, width } = useMobileViewport();
  const isShortPhone = viewportShortPhone || (isCompactPhone && visibleHeight <= 840);
  const shouldTopAlign = isShortPhone;
  const prefersReducedMotion = useReducedMotion();
  const isPerformanceMode = Boolean(
    prefersReducedMotion || (isNativePlatform() && getNativePlatform() === "android"),
  );
  const [currentStep, setCurrentStep] = useState(0);
  const [prevStep, setPrevStep] = useState(-1);
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

  const handleGetStarted = () => {
    storageRemove(STORAGE_KEY);
    completeOnboarding();
    const analysis = getAnalysisSummary(answers);
    void updateShadowNotes(analysis.overview);
    window.requestAnimationFrame(() => navigate("/", { replace: true }));
  };

  // Staggered welcome screen
  if (!hasStarted) {
    const makeStagger = (delay: number) =>
      isPerformanceMode
        ? {}
        : {
            initial: { opacity: 0, y: 14 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.44, ease: [0.22, 1, 0.36, 1], delay },
          };

    return (
      <div className={cn("app-screen-scroll sanctuary-screen relative flex w-full flex-col", isShortPhone ? "px-3 py-3" : "px-4 py-6")}>
        <div className="sanctuary-atmosphere" />
        <div
          className={cn(
            "sanctuary-surface relative z-10 mx-auto my-auto w-full max-w-md rounded-[1.35rem] text-center",
            isShortPhone ? "px-4 py-5" : "px-6 py-8 sm:px-8 sm:py-10",
          )}
        >
          {/* Logo — scale in */}
          <motion.div
            className={cn("sanctuary-brand-mark mx-auto", isShortPhone ? "mb-4 h-16 w-16" : "mb-6 h-20 w-20")}
            initial={isPerformanceMode ? false : { opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.52, ease: [0.22, 1, 0.36, 1], delay: 0.05 }}
          >
            <AppLogo className="h-full w-full object-cover" />
          </motion.div>

          <motion.p className={cn("app-kicker", isShortPhone ? "mb-2" : "mb-3")} {...makeStagger(0.18)}>A gentler beginning</motion.p>
          <motion.h1
            className={cn("app-heading font-serif leading-[1.12]", isShortPhone ? "text-[2rem]" : "text-[2.35rem] sm:text-[2.65rem]")}
            {...makeStagger(0.26)}
          >
            A reflection space shaped around you.
          </motion.h1>
          <motion.p
            className={cn("app-muted mx-auto max-w-sm", isShortPhone ? "mt-3 text-[14px] leading-6" : "mt-4 text-[15px] leading-7")}
            {...makeStagger(0.34)}
          >
            Answer three thoughtful questions so Bible Nova can meet you with the right tone, scripture, and next step.
          </motion.p>

          {/* Preview card */}
          <motion.div
            className={cn("sanctuary-preview rounded-[1.35rem] text-left", isShortPhone ? "my-4 px-4 py-3" : "my-7 px-5 py-4")}
            {...makeStagger(0.44)}
          >
            <p className="app-kicker mb-2 text-[9px]">Your daily moment</p>
            <p className="scripture-copy app-heading text-xl leading-snug">Pause. Name what you're carrying. Receive one clear place to begin.</p>
          </motion.div>

          {/* CTA */}
          <motion.button
            type="button"
            onClick={() => setHasStarted(true)}
            className={cn("touch-target app-primary-button app-card-shimmer flex w-full items-center justify-center gap-2 rounded-[1rem] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "py-3.5" : "py-4")}
            {...makeStagger(0.54)}
          >
            Personalize my space
            <Sparkles className="h-4.5 w-4.5" />
          </motion.button>

          <motion.p
            className={cn("app-muted leading-relaxed", isShortPhone ? "mt-3 text-[10px]" : "mt-4 text-[11px]")}
            {...makeStagger(0.62)}
          >
            Your answers are used only to personalize your experience.
          </motion.p>
        </div>
      </div>
    );
  }

  if (showAnalysis) {
    const analysis = getAnalysisSummary(answers);

    return (
      <div
        className={cn("app-screen-scroll sanctuary-screen relative flex w-full flex-col items-center justify-start scrollbar-hide", isShortPhone ? "px-3 py-3" : "px-4 py-5")}
      >
        <div className="sanctuary-atmosphere" />

        <motion.div
          initial={isPerformanceMode ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: isPerformanceMode ? 0 : 0.22, ease: "easeOut" }}
          className={cn(
            "sanctuary-surface shrink-0 relative z-10 w-full max-w-md rounded-[1.35rem]",
            !shouldTopAlign && "my-auto",
            isShortPhone ? "p-4" : isCompactPhone ? "p-5" : "p-6 sm:p-8",
          )}
        >
          <button
            onClick={handleBack}
            className={cn("app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "mb-3" : "mb-6")}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className={cn("text-center", isShortPhone ? "mb-4" : "mb-6")}>
            <p className={cn("app-kicker", isShortPhone ? "mb-2" : "mb-3")}>A space made for you</p>
            <h2 className={cn("app-heading pb-1 font-serif leading-[1.18]", isShortPhone ? "mb-3 text-[1.75rem]" : isCompactPhone ? "mb-4 text-[2rem]" : "mb-4 text-[2.25rem]")}>
              Your reflection space is ready.
            </h2>
            <p className={cn("app-muted mx-auto max-w-sm", isShortPhone ? "text-[14px] leading-snug" : "text-[15px] leading-relaxed")}>
              {analysis.overview}
            </p>
          </div>

          <div className={cn(isShortPhone ? "mb-4 space-y-3" : "mb-7 space-y-4")}>
            {/* Scripture preview */}
            <motion.div
              className={cn("sanctuary-preview rounded-[1.35rem]", isShortPhone ? "px-4 py-4" : "px-5 py-5")}
              initial={isPerformanceMode ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
            >
              <div className={cn("flex items-center justify-between gap-3", isShortPhone ? "mb-3" : "mb-4")}>
                <p className="app-kicker text-[9px]">A glimpse of your space</p>
                <span className="app-accent-badge rounded-pill px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.15em]">Personalized</span>
              </div>
              <p className="scripture-copy app-heading text-[1.4rem] leading-snug">"Be still, and know that I am God."</p>
              <p className="app-accent mt-1 text-[11px] font-semibold uppercase tracking-[0.14em]">Psalm 46:10</p>
              <div className={cn("app-divider border-t", isShortPhone ? "my-3" : "my-4")} />
              <p className={cn("app-muted leading-relaxed", isShortPhone ? "text-[13px]" : "text-sm")}>Begin by naming the one thing that feels heaviest today. You do not need to solve it all at once.</p>
            </motion.div>

            {/* Next step — elevated accent card instead of plain border note */}
            <motion.div
              className="rounded-[1.25rem] p-4"
              style={{
                background: "linear-gradient(135deg, color-mix(in srgb, var(--app-accent) 12%, transparent), color-mix(in srgb, var(--app-accent) 5%, transparent))",
                border: "1px solid color-mix(in srgb, var(--app-accent) 28%, transparent)",
              }}
              initial={isPerformanceMode ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
            >
              <div className="mb-2.5 flex items-center gap-2.5">
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full"
                  style={{ background: "color-mix(in srgb, var(--app-accent) 18%, transparent)", color: "var(--app-accent)" }}
                >
                  <BookOpen className="h-4 w-4" strokeWidth={2} />
                </span>
                <p className="app-kicker text-[9.5px]">Your next gentle step</p>
              </div>
              <p className="app-heading text-[14px] leading-relaxed">{analysis.appResponse}</p>
            </motion.div>
          </div>

          <motion.button
            onClick={handleGetStarted}
            className={cn("touch-target app-primary-button app-card-shimmer flex w-full items-center justify-center rounded-[1rem] font-semibold text-white transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", isShortPhone ? "py-3.5" : "py-4")}
            style={{ boxShadow: "var(--app-accent-shadow)" }}
            initial={isPerformanceMode ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          >
            Begin my first reflection
          </motion.button>
        </motion.div>
      </div>
    );
  }

  const question = questions[currentStep];
  const completedCount = questions.filter((item) => Boolean(answers[item.id])).length;
  const isFirstQuestion = currentStep === 0;
  const fitFirstQuestionToViewport =
    isFirstQuestion && width <= 768 && visibleHeight > 0 && visibleHeight <= 960;

  // Slide direction: forward = slide left in, backward = slide right in
  const isGoingForward = prevStep < currentStep;
  const slideVariants = {
    initial: { opacity: 0, x: isGoingForward ? 24 : -24 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: isGoingForward ? -24 : 24 },
  };

  return (
    <div
      className={cn(
        fitFirstQuestionToViewport
          ? "onboarding-question-screen sanctuary-screen relative flex w-full flex-col overflow-x-hidden"
          : "app-screen-scroll sanctuary-screen relative flex w-full flex-col overflow-x-hidden",
        fitFirstQuestionToViewport ? "px-2.5" : isShortPhone ? "px-3" : "px-4",
      )}
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${fitFirstQuestionToViewport ? "0.5rem" : isShortPhone ? "0.75rem" : "2rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${fitFirstQuestionToViewport ? "0.5rem" : isShortPhone ? "0.75rem" : "2.25rem"})`,
      }}
    >
      <div className="sanctuary-atmosphere" />

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col">
        {/* Header: back + progress */}
        <div className={cn("flex shrink-0 items-center justify-between", fitFirstQuestionToViewport ? "mb-2" : isShortPhone ? "mb-3" : "mb-7")}>
          <button
            onClick={handleBack}
            className="touch-target app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          {/* Thicker progress dots with smooth active transition */}
          <div
            className="flex items-center gap-2"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={questions.length}
            aria-valuenow={completedCount}
            aria-label={`${completedCount} of ${questions.length} questions completed`}
          >
            {questions.map((item, index) => (
              <motion.span
                key={item.id}
                className="block rounded-full"
                animate={{
                  width: index === currentStep ? "2rem" : "0.625rem",
                  background: index <= currentStep ? "var(--app-accent)" : "var(--app-card-border)",
                  opacity: index > currentStep ? 0.5 : 1,
                }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                style={{ height: "0.5rem" }}
              />
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={currentStep}
            variants={isPerformanceMode ? {} : slideVariants}
            initial={isPerformanceMode ? false : "initial"}
            animate="animate"
            exit={isPerformanceMode ? undefined : "exit"}
            transition={{ duration: isPerformanceMode ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "sanctuary-surface flex min-h-0 flex-1 flex-col rounded-[1.35rem]",
              fitFirstQuestionToViewport
                ? "overflow-hidden px-3.5 py-3.5"
                : isShortPhone
                  ? "shrink-0 px-4 py-4"
                  : "shrink-0 px-5 py-6 sm:px-7 sm:py-8",
            )}
          >
            <span className={cn("app-kicker inline-flex text-xs font-semibold", fitFirstQuestionToViewport ? "mb-2 text-[10px] leading-none" : isShortPhone ? "mb-3" : "mb-4")}>
              Question {currentStep + 1} of {questions.length}
            </span>
            <h1 className={cn("app-heading pb-1 font-serif", fitFirstQuestionToViewport ? "mb-2 text-[1.65rem] leading-[1.08]" : isShortPhone ? "mb-3 leading-[1.18] text-[1.75rem]" : isCompactPhone ? "mb-4 leading-[1.18] text-[2rem]" : "mb-4 leading-[1.18] text-3xl sm:text-4xl")}>
              {question.title}
            </h1>
            <p className={cn("app-muted max-w-sm", fitFirstQuestionToViewport ? "mb-2.5 text-[13px] leading-[1.35]" : isShortPhone ? "mb-4 text-[14px] leading-snug" : "mb-10")}>
              Choose what feels most true right now. You can change your preferences later.
            </p>

            {currentStep === 0 && (
              <div className={cn("sanctuary-trust", fitFirstQuestionToViewport ? "mb-2 pt-2 text-[10px] leading-[1.35]" : isShortPhone ? "mb-3 text-[11px]" : "mb-5")}>
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--app-success)" }} />
                <span>This helps personalize your reflections. You can update your preferences later.</span>
              </div>
            )}

            <div role="radiogroup" aria-label={question.title} className={cn(fitFirstQuestionToViewport ? "space-y-1.5" : isShortPhone ? "space-y-2" : isCompactPhone ? "space-y-3" : "space-y-4")}>
              {question.options.map((option, optIdx) => {
                const isSelected = answers[question.id] === option.id;
                return (
                  <motion.button
                    key={option.id}
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleSelect(option.id)}
                    whileHover={isPerformanceMode ? {} : { scale: 1.012, y: -1 }}
                    whileTap={isPerformanceMode ? {} : { scale: 0.985 }}
                    className={cn("touch-target sanctuary-option flex w-full items-center justify-between rounded-[1rem] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", fitFirstQuestionToViewport ? "min-h-[48px] p-2" : isShortPhone ? "p-2.5" : isCompactPhone ? "p-4" : "p-5")}
                    initial={isPerformanceMode ? false : { opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.22, ease: "easeOut", delay: optIdx * 0.055 }}
                  >
                    <div className={cn("flex min-w-0 items-center", fitFirstQuestionToViewport ? "gap-2.5" : isShortPhone ? "gap-3" : "gap-4")}>
                      {option.icon && (
                        <div
                          className={cn("rounded-full transition-all duration-150", fitFirstQuestionToViewport ? "p-1.5" : isShortPhone ? "p-1.5" : "p-2")}
                          style={{
                            background: isSelected ? "color-mix(in srgb, var(--app-accent) 18%, transparent)" : "var(--app-card-soft)",
                            color: isSelected ? "var(--app-accent)" : "var(--app-text-muted)",
                          }}
                        >
                          {option.icon}
                        </div>
                      )}
                      <span
                        className={cn("min-w-0 transition-all duration-150", fitFirstQuestionToViewport ? "text-[14px] leading-[1.2]" : isShortPhone ? "leading-snug text-[15px]" : isCompactPhone ? "leading-snug text-[16px]" : "leading-snug text-lg")}
                        style={{
                          color: isSelected ? "var(--app-accent)" : "var(--app-text)",
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        {option.label}
                      </span>
                    </div>
                    <span
                      className={cn("flex shrink-0 items-center justify-center rounded-full border transition-all duration-150", fitFirstQuestionToViewport ? "h-5 w-5" : isShortPhone ? "h-5 w-5" : "h-6 w-6")}
                      style={{
                        borderColor: isSelected ? "var(--app-accent)" : "var(--app-card-border)",
                        background: isSelected ? "var(--app-accent)" : "transparent",
                      }}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                    </span>
                  </motion.button>
                );
              })}
            </div>

            <div className={cn("sanctuary-action", fitFirstQuestionToViewport ? "mt-auto pt-2" : isShortPhone ? "mt-4" : "mt-6")}>
              <button
                type="button"
                onClick={handleContinue}
                disabled={!answers[question.id]}
                className={cn("touch-target app-primary-button app-card-shimmer flex w-full items-center justify-center gap-2 rounded-[1rem] font-semibold disabled:cursor-not-allowed disabled:opacity-45 disabled:grayscale focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]", fitFirstQuestionToViewport ? "py-3" : isShortPhone ? "py-3.5" : "py-4")}
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
