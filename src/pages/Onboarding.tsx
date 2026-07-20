import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Check, BookOpen, ChevronRight, Wind } from "lucide-react";
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

export default function Onboarding() {
  useDocumentTitle("Welcome | Bible Nova Companion");
  const { isCompactPhone, isShortPhone: viewportShortPhone, visibleHeight, width } = useMobileViewport();
  const isShortPhone = viewportShortPhone || (isCompactPhone && visibleHeight <= 840);
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
    
    // Auto-advance after a tiny delay for a premium feel
    setTimeout(() => {
      handleContinue(optionId);
    }, 400);
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

  const BackgroundOrbs = () => (
    <>
      <motion.div
        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.4, 0.3], x: [0, 30, 0], y: [0, -40, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
        className="absolute -top-[10%] -left-[10%] h-[500px] w-[500px] rounded-full bg-amber-500/10 blur-[100px] pointer-events-none"
      />
      <motion.div
        animate={{ scale: [1, 1.3, 1], opacity: [0.2, 0.3, 0.2], x: [0, -30, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "linear", delay: 2 }}
        className="absolute top-[50%] -right-[10%] h-[600px] w-[600px] rounded-full bg-rose-500/10 blur-[120px] pointer-events-none"
      />
    </>
  );

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
      <div className="relative min-h-screen w-full overflow-hidden bg-[#0F0F12] text-white flex flex-col justify-center items-center px-4 py-8">
        <BackgroundOrbs />
        
        <div className="relative z-10 w-full max-w-md flex flex-col items-center text-center">
          {/* Logo — scale in */}
          <motion.div
            className="mb-8 relative"
            initial={isPerformanceMode ? false : { opacity: 0, scale: 0.5, rotate: -10 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 200, damping: 20, delay: 0.1 }}
          >
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
              className="absolute -inset-4 rounded-full border border-amber-500/20 border-t-amber-500/60"
            />
            <div className="h-24 w-24 rounded-full overflow-hidden shadow-[0_0_50px_rgba(245,158,11,0.25)] bg-gradient-to-br from-[#1a1a1e] to-[#0F0F12] p-1.5 flex items-center justify-center">
              <AppLogo className="h-full w-full object-cover rounded-full" />
            </div>
          </motion.div>

          <motion.div {...makeStagger(0.2)} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-white/70 text-xs font-semibold tracking-wider uppercase mb-5">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            Welcome to Bible Nova
          </motion.div>
          
          <motion.h1
            className="font-serif text-4xl sm:text-5xl leading-tight mb-4 tracking-tight bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent"
            {...makeStagger(0.3)}
          >
            A quieter place to return to.
          </motion.h1>
          
          <motion.p
            className="text-white/60 text-[15px] sm:text-[16px] leading-relaxed max-w-sm mb-10"
            {...makeStagger(0.4)}
          >
            Answer three thoughtful questions to shape your personalized reflection space.
          </motion.p>

          {/* CTA */}
          <motion.div className="w-full" {...makeStagger(0.5)}>
            <button
              onClick={() => setHasStarted(true)}
              className="relative w-full overflow-hidden group bg-gradient-to-r from-amber-500 to-amber-600 text-amber-950 font-bold text-lg rounded-[1.25rem] py-4 flex items-center justify-center gap-2 hover:from-amber-400 hover:to-amber-500 transition-all shadow-[0_8px_30px_rgba(245,158,11,0.3)] hover:shadow-[0_8px_40px_rgba(245,158,11,0.4)] hover:-translate-y-1"
            >
              <div className="absolute inset-0 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-12" />
              Begin Your Journey
              <ChevronRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </button>
          </motion.div>
          
          <motion.div className="mt-6 flex items-center justify-center gap-2 text-white/30 text-xs" {...makeStagger(0.6)}>
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Your answers are private.</span>
          </motion.div>
        </div>
      </div>
    );
  }

  if (showAnalysis) {
    const analysis = getAnalysisSummary(answers);

    return (
      <div className="relative min-h-screen w-full overflow-hidden bg-[#0F0F12] text-white flex flex-col justify-center items-center px-4 py-6">
        <BackgroundOrbs />

        <motion.div
          initial={isPerformanceMode ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-10 w-full max-w-md flex flex-col"
        >
          <button
            onClick={handleBack}
            className="self-start inline-flex items-center gap-2 rounded-full px-4 py-2 bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors text-sm font-medium mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="text-center mb-8">
            <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/20 text-amber-500 mb-4 border border-amber-500/30">
              <Check className="w-6 h-6" strokeWidth={3} />
            </span>
            <h2 className="font-serif text-3xl sm:text-4xl leading-tight mb-3 bg-gradient-to-br from-white to-white/60 bg-clip-text text-transparent">
              Your space is ready.
            </h2>
            <p className="text-white/60 text-[15px] leading-relaxed max-w-sm mx-auto">
              {analysis.overview}
            </p>
          </div>

          <div className="space-y-4 mb-8">
            {/* Scripture preview */}
            <motion.div
              className="bg-gradient-to-br from-white/10 to-white/5 border border-white/10 rounded-[1.5rem] p-6 backdrop-blur-md relative overflow-hidden"
              initial={isPerformanceMode ? false : { opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <div className="absolute top-0 right-0 p-6 opacity-5 pointer-events-none">
                <BookOpen className="w-24 h-24 rotate-12" />
              </div>
              <div className="flex items-center justify-between mb-4 relative z-10">
                <span className="text-white/50 text-[10px] uppercase tracking-widest font-semibold">Glimpse</span>
                <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider">Personalized</span>
              </div>
              <p className="font-serif text-[1.5rem] leading-snug mb-2 text-white/90 relative z-10">"Be still, and know that I am God."</p>
              <p className="text-amber-500 text-[11px] font-bold uppercase tracking-widest relative z-10">Psalm 46:10</p>
            </motion.div>

            {/* Next step */}
            <motion.div
              className="bg-gradient-to-br from-amber-500/15 to-transparent border border-amber-500/30 rounded-[1.5rem] p-5 relative overflow-hidden"
              initial={isPerformanceMode ? false : { opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              <div className="flex items-center gap-3 mb-3 relative z-10">
                <div className="bg-amber-500 text-amber-950 p-1.5 rounded-lg">
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="text-amber-400 text-[10px] font-bold uppercase tracking-widest">How we'll help</span>
              </div>
              <p className="text-white/80 text-[14px] leading-relaxed relative z-10">{analysis.appResponse}</p>
            </motion.div>
          </div>

          <motion.button
            onClick={handleGetStarted}
            className="w-full bg-white text-black font-bold text-lg rounded-[1.25rem] py-4 flex items-center justify-center transition-all hover:bg-gray-100 shadow-[0_0_40px_rgba(255,255,255,0.15)] hover:shadow-[0_0_50px_rgba(255,255,255,0.25)] hover:-translate-y-1"
            initial={isPerformanceMode ? false : { opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            Enter Sanctuary
          </motion.button>
        </motion.div>
      </div>
    );
  }

  const question = questions[currentStep];
  const completedCount = questions.filter((item) => Boolean(answers[item.id])).length;
  const progressPercent = ((currentStep) / (questions.length - 1)) * 100;

  // Slide direction: forward = slide left in, backward = slide right in
  const isGoingForward = prevStep < currentStep;
  const slideVariants = {
    initial: { opacity: 0, x: isGoingForward ? 40 : -40, scale: 0.95 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit: { opacity: 0, x: isGoingForward ? -40 : 40, scale: 0.95 },
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[#0F0F12] text-white flex flex-col pt-12 pb-8 px-4">
      <BackgroundOrbs />

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        {/* Header: back + progress */}
        <div className="flex items-center justify-between mb-8">
          <button
            onClick={handleBack}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 max-w-[150px] ml-4">
            <div className="h-1.5 w-full bg-white/10 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-amber-500 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
            <div className="text-right mt-1.5">
              <span className="text-[10px] text-white/40 font-semibold tracking-widest uppercase">
                Step {currentStep + 1} of {questions.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col justify-center">
          <AnimatePresence mode="wait" custom={isGoingForward}>
            <motion.div
              key={currentStep}
              variants={isPerformanceMode ? {} : slideVariants}
              initial={isPerformanceMode ? false : "initial"}
              animate="animate"
              exit={isPerformanceMode ? undefined : "exit"}
              transition={{ type: "spring", stiffness: 260, damping: 25 }}
              className="w-full"
            >
              <h1 className="font-serif text-3xl sm:text-4xl leading-tight mb-3 tracking-tight bg-gradient-to-br from-white to-white/70 bg-clip-text text-transparent">
                {question.title}
              </h1>
              <p className="text-white/50 text-[14px] mb-8">
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
                      whileHover={isPerformanceMode ? {} : { scale: 1.02 }}
                      whileTap={isPerformanceMode ? {} : { scale: 0.98 }}
                      className={cn(
                        "w-full flex items-center justify-between p-4 sm:p-5 rounded-2xl text-left transition-all duration-300 border focus:outline-none focus:ring-2 focus:ring-amber-500 group overflow-hidden relative",
                        isSelected 
                          ? "bg-amber-500/10 border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.1)]" 
                          : "bg-white/5 border-white/10 hover:bg-white/10"
                      )}
                      initial={isPerformanceMode ? false : { opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: optIdx * 0.08 }}
                    >
                      {/* Active glow background */}
                      {isSelected && (
                        <motion.div 
                          layoutId="active-bg"
                          className="absolute inset-0 bg-gradient-to-r from-amber-500/5 to-transparent pointer-events-none"
                        />
                      )}
                      
                      <div className="flex items-center gap-4 relative z-10">
                        {option.icon && (
                          <div
                            className={cn(
                              "p-2.5 rounded-xl transition-colors duration-300",
                              isSelected ? "bg-amber-500 text-amber-950" : "bg-white/5 text-white/50 group-hover:text-white/80 group-hover:bg-white/10"
                            )}
                          >
                            {option.icon}
                          </div>
                        )}
                        <span
                          className={cn(
                            "text-[15px] sm:text-[16px] transition-colors duration-300",
                            isSelected ? "text-amber-500 font-semibold" : "text-white/80 font-medium"
                          )}
                        >
                          {option.label}
                        </span>
                      </div>
                      
                      <div
                        className={cn(
                          "flex shrink-0 items-center justify-center rounded-full border-2 transition-all duration-300 w-6 h-6 relative z-10",
                          isSelected ? "border-amber-500 bg-amber-500" : "border-white/20 bg-transparent group-hover:border-white/40"
                        )}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-950" strokeWidth={4} />}
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
