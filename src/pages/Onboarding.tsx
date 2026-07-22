import React, { useEffect, useRef, useState, memo } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Check, BookOpen, ChevronRight, Wind } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
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

// Defined outside component to avoid re-creating on every render
const BackgroundOrbs = memo(({ animated = true }: { animated?: boolean }) => {
  if (!animated) return null;

  return (
    <>
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.25, 0.4, 0.25], x: [0, 30, 0], y: [0, -40, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="pointer-events-none absolute -top-[10%] -left-[10%] h-[500px] w-[500px] rounded-full"
        style={{ background: "rgba(245,158,11,0.08)", filter: "blur(100px)" }}
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.15, 0.28, 0.15], x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 2 }}
        className="pointer-events-none absolute top-[50%] -right-[10%] h-[600px] w-[600px] rounded-full"
        style={{ background: "rgba(239,68,68,0.07)", filter: "blur(120px)" }}
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
  const shouldAnimateLightly = !prefersReducedMotion;
  const [currentStep, setCurrentStep] = useState(0);
  const [prevStep, setPrevStep] = useState(-1);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    storageGetJson<Record<string, string>>(STORAGE_KEY, {}),
  );
  const [hasStarted, setHasStarted] = useState(() => Object.keys(answers).length > 0);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [isAdvancing, setIsAdvancing] = useState(false);
  const continueTimerRef = useRef<number | null>(null);
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

  useEffect(() => () => {
    if (continueTimerRef.current !== null) {
      window.clearTimeout(continueTimerRef.current);
    }
  }, []);

  const handleSelect = (optionId: string) => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    const question = questions[currentStep];
    setAnswers((currentAnswers) => ({ ...currentAnswers, [question.id]: optionId }));

    if (continueTimerRef.current !== null) {
      window.clearTimeout(continueTimerRef.current);
    }

    // Keep the selected state visible long enough to feel acknowledged.
    continueTimerRef.current = window.setTimeout(() => {
      continueTimerRef.current = null;
      handleContinue(optionId);
      setIsAdvancing(false);
    }, prefersReducedMotion ? 120 : 275);
  };

  const handleContinue = (overrideAnswer?: string) => {
    const currentAnswer = overrideAnswer || answers[questions[currentStep].id];
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
            initial: { opacity: 0, y: 20 },
            animate: { opacity: 1, y: 0 },
            transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay },
          };

    return (
      <div
        className="relative min-h-[100dvh] w-full overflow-y-auto overflow-x-hidden text-white flex flex-col justify-center items-center px-5 pb-8"
        style={{
          background: "#0F0F12",
          paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "2rem" : "3rem"})`,
        }}
      >
        <BackgroundOrbs animated={!disableAmbientMotion} />
        
        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
          <motion.div
            {...makeStagger(0.2)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full mb-5"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-white/70 text-xs font-semibold tracking-wider uppercase">Welcome to Bible Nova</span>
          </motion.div>
          
          <motion.h1
            className="font-serif text-4xl sm:text-5xl leading-tight mb-4 tracking-tight"
            style={{ background: "linear-gradient(180deg, #fff 0%, rgba(255,255,255,0.6) 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
            {...makeStagger(0.3)}
          >
            A quieter place to return to.
          </motion.h1>
          
          <motion.p
            className="text-white/55 text-[15px] sm:text-[16px] leading-relaxed max-w-sm mb-8"
            {...makeStagger(0.4)}
          >
            Answer three thoughtful questions to shape your personalized reflection space.
          </motion.p>

          {/* CTA */}
          <motion.div className="w-full" {...makeStagger(0.5)}>
            <button
              onClick={() => setHasStarted(true)}
              className="relative w-full overflow-hidden group text-amber-950 font-bold text-lg rounded-[1.25rem] py-4 flex items-center justify-center gap-2 transition-all"
              style={{
                background: "linear-gradient(135deg, #f59e0b, #d97706)",
                boxShadow: "0 8px 30px rgba(245,158,11,0.32)",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 10px 40px rgba(245,158,11,0.44)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-2px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 8px 30px rgba(245,158,11,0.32)"; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)"; }}
            >
              <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12 pointer-events-none" />
              Begin Your Journey
              <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>
          
          <motion.div className="mt-5 flex items-center justify-center gap-2" style={{ color: "rgba(255,255,255,0.28)" }} {...makeStagger(0.6)}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span className="text-xs">Your answers personalize this space and are saved with your account.</span>
          </motion.div>
        </div>
      </div>
    );
  }

  if (showAnalysis) {
    const analysis = getAnalysisSummary(answers);

    return (
      <div
        className="relative w-full overflow-y-auto text-white flex flex-col justify-start items-center px-4 pb-8"
        style={{
          minHeight: "100dvh",
          background: "#0F0F12",
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
            className="self-start inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium mb-8 transition-colors"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)"; }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="text-center mb-8">
            <span className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
              <Check className="w-7 h-7 text-amber-400" strokeWidth={2.5} />
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl leading-tight mb-3" style={{ background: "linear-gradient(180deg, #fff, rgba(255,255,255,0.6))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              Your space is ready.
            </h2>
            <p className="text-[15px] leading-relaxed max-w-sm mx-auto" style={{ color: "rgba(255,255,255,0.58)" }}>
              {analysis.overview}
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {/* Scripture preview */}
            <motion.div
              className="relative overflow-hidden rounded-[1.5rem] p-6"
              style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))", border: "1px solid rgba(255,255,255,0.1)" }}
              initial={isPerformanceMode ? false : { opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={isPerformanceMode ? { duration: 0 } : { duration: 0.5, delay: 0.2 }}
            >
              <div className="absolute top-0 right-0 p-5 pointer-events-none" style={{ opacity: 0.05 }}>
                <BookOpen className="w-24 h-24 rotate-12" />
              </div>
              <div className="flex items-center justify-between mb-4 relative z-10">
                <span className="text-[10px] uppercase tracking-widest font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>Glimpse</span>
                <span className="rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-amber-400" style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.25)" }}>Personalized</span>
              </div>
              <p className="font-serif text-[1.5rem] leading-snug mb-2 relative z-10" style={{ color: "rgba(255,255,255,0.9)" }}>"Be still, and know that I am God."</p>
              <p className="text-[11px] font-bold uppercase tracking-widest relative z-10 text-amber-400">Psalm 46:10</p>
            </motion.div>

          </div>

          <motion.button
            onClick={handleGetStarted}
            className="w-full font-bold text-lg rounded-[1.25rem] py-4 flex items-center justify-center transition-all"
            style={{ background: "#fff", color: "#000" }}
            initial={isPerformanceMode ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={isPerformanceMode ? { duration: 0 } : { duration: 0.5, delay: 0.44 }}
            whileHover={isPerformanceMode ? {} : { scale: 1.01, boxShadow: "0 0 50px rgba(255,255,255,0.22)" }}
            whileTap={isPerformanceMode ? {} : { scale: 0.98 }}
          >
            Enter Bible Nova
          </motion.button>
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

  return (
    <div
      className="relative w-full overflow-y-auto text-white flex flex-col pb-8 px-4"
      style={{
        minHeight: "100dvh",
        background: "#0F0F12",
        paddingTop: "max(env(safe-area-inset-top, 0px), 3rem)",
      }}
    >
      <BackgroundOrbs animated={!disableAmbientMotion} />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Header: back + progress */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full transition-colors focus:outline-none"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.7)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.05)"; }}
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 max-w-[160px] ml-4">
            <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #f59e0b, #fbbf24)" }}
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.45, ease: "easeOut" }}
              />
            </div>
            <div className="text-right mt-1.5">
              <span className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.35)" }}>
                Step {currentStep + 1} of {questions.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait" custom={isGoingForward}>
            <motion.div
              key={currentStep}
              variants={shouldAnimateLightly ? slideVariants : {}}
              initial={shouldAnimateLightly ? "initial" : false}
              animate={shouldAnimateLightly ? "animate" : undefined}
              exit={shouldAnimateLightly ? "exit" : undefined}
              transition={shouldAnimateLightly ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] } : undefined}
              className="w-full"
            >
              <h1
                className="font-serif text-3xl sm:text-4xl leading-tight mb-3 tracking-tight"
                style={{ background: "linear-gradient(180deg, #fff, rgba(255,255,255,0.7))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}
              >
                {question.title}
              </h1>
              <p className="text-[14px] mb-8" style={{ color: "rgba(255,255,255,0.45)" }}>
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
                      whileHover={isPerformanceMode ? {} : { scale: 1.02, y: -1 }}
                      whileTap={shouldAnimateLightly ? { scale: 0.985 } : {}}
                      className="w-full flex items-center justify-between p-4 sm:p-5 rounded-2xl text-left transition-all duration-300 relative overflow-hidden"
                      style={{
                        background: isSelected ? "rgba(245,158,11,0.1)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${isSelected ? "rgba(245,158,11,0.48)" : "rgba(255,255,255,0.08)"}`,
                        boxShadow: isSelected ? "0 0 24px rgba(245,158,11,0.08)" : "none",
                        outline: "none",
                      }}
                      initial={isPerformanceMode ? false : { opacity: 0, y: 16 }}
                      animate={isPerformanceMode ? undefined : { opacity: 1, y: 0 }}
                      transition={isPerformanceMode ? undefined : { duration: 0.26, delay: optIdx * 0.04 }}
                    >
                      {isSelected && (
                        <motion.div
                          layoutId="active-option-bg"
                          className="absolute inset-0 pointer-events-none"
                          style={{ background: "linear-gradient(90deg, rgba(245,158,11,0.06), transparent)" }}
                        />
                      )}
                      
                      <div className="flex items-center gap-4 relative z-10">
                        {option.icon && (
                          <div
                            className="p-2.5 rounded-xl transition-colors duration-300"
                            style={{
                              background: isSelected ? "#f59e0b" : "rgba(255,255,255,0.05)",
                              color: isSelected ? "#422006" : "rgba(255,255,255,0.45)",
                            }}
                          >
                            {option.icon}
                          </div>
                        )}
                        <span
                          className="text-[15px] sm:text-[16px] transition-colors duration-300 font-medium"
                          style={{ color: isSelected ? "#f59e0b" : "rgba(255,255,255,0.78)" }}
                        >
                          {option.label}
                        </span>
                      </div>
                      
                      <div
                        className="flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 w-6 h-6 relative z-10 ml-3"
                        style={{
                          borderColor: isSelected ? "#f59e0b" : "rgba(255,255,255,0.18)",
                          background: isSelected ? "#f59e0b" : "transparent",
                        }}
                      >
                        {isSelected && (
                          <motion.div
                            initial={shouldAnimateLightly ? { scale: 0.5, opacity: 0 } : false}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={shouldAnimateLightly ? { duration: 0.16, ease: "easeOut" } : undefined}
                          >
                            <Check className="w-3.5 h-3.5 text-amber-950" strokeWidth={3.5} />
                          </motion.div>
                        )}
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
