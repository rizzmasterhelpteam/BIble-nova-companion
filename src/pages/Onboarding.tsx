import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Sunrise } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { motion, AnimatePresence } from "motion/react";
import { cn, useDocumentTitle } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";

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
    id: "frequency",
    title: "How often do you reflect on your spirituality?",
    options: [
      { id: "daily", label: "Every day" },
      { id: "weekly", label: "Once a week" },
      { id: "rarely", label: "Rarely, but I want to start" },
      { id: "never", label: "Never" },
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
  {
    id: "rhythm",
    title: "When do you most need reflection?",
    options: [
      { id: "morning", label: "At the start of the day", icon: <Sunrise className="w-5 h-5" /> },
      { id: "evening", label: "Before sleep" },
      { id: "stressful", label: "During stressful moments" },
      { id: "uncertain", label: "When I feel uncertain" },
    ],
  },
];

const getSelectedLabel = (answers: Record<string, string>, questionId: string) => {
  const question = questions.find((item) => item.id === questionId);
  const selected = question?.options.find((option) => option.id === answers[questionId]);
  return selected?.label || "Personal reflection";
};

export default function Onboarding() {
  useDocumentTitle("Welcome | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  });
  const [showAnalysis, setShowAnalysis] = useState(false);
  const { completeOnboarding } = useAuth();
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
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
    } catch {
      return;
    }
  }, [answers]);

  const handleSelect = (optionId: string) => {
    const question = questions[currentStep];
    const nextAnswers = { ...answers, [question.id]: optionId };

    setAnswers(nextAnswers);

    if (currentStep < questions.length - 1) {
      window.setTimeout(() => setCurrentStep((prev) => prev + 1), 220);
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

    if (currentStep === 0) return;
    setCurrentStep((prev) => prev - 1);
  };

  const handleGetStarted = () => {
    localStorage.removeItem(STORAGE_KEY);
    completeOnboarding();
    navigate("/paywall");
  };

  if (showAnalysis) {
    const reason = getSelectedLabel(answers, "reason").toLowerCase();
    const goal = getSelectedLabel(answers, "goal").toLowerCase();
    const support = getSelectedLabel(answers, "support").toLowerCase();
    const rhythm = getSelectedLabel(answers, "rhythm").toLowerCase();

    return (
      <div
        className={cn(
          "app-screen-scroll relative flex flex-col items-center px-4 py-4 scrollbar-hide",
          isShortPhone ? "justify-start" : "justify-center",
        )}
      >
        <div className="app-atmosphere">
          <div className="app-grid" />
          <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
          <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className={cn(
            "app-panel relative z-10 w-full max-w-md rounded-[2rem] shadow-2xl",
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

          <div className={cn("flex justify-center", isShortPhone ? "mb-5" : "mb-7")}>
            <div className={cn("app-logo-badge flex items-center justify-center rounded-full ring-1 ring-white/10", isCompactPhone ? "h-16 w-16" : "h-20 w-20")}>
              <ChristianCross className="h-9 w-9 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <div className="text-center">
            <p className="app-kicker mb-3">Your Reflection Analysis</p>
            <h2 className={cn("app-heading mb-4 pb-1 font-serif leading-[1.24]", isCompactPhone ? "text-[2rem]" : "text-3xl")}>
              Your path is taking shape.
            </h2>
            <p className="app-muted mx-auto mb-6 max-w-sm text-[15px] leading-relaxed">
              Bible Nova Companion will focus on {reason}, help you move toward {goal}, and respond with {support} when you need it most.
            </p>
          </div>

          <div className={cn("space-y-3", isShortPhone ? "mb-5" : "mb-7")}>
            <div
              className="rounded-card border p-4"
              style={{ borderColor: "var(--app-card-border)", background: "var(--app-card-soft)" }}
            >
              <p className="app-kicker mb-2 text-[10px]">Guidance Style</p>
              <p className="app-heading text-sm leading-relaxed">
                A calm companion for {support}, especially {rhythm}.
              </p>
            </div>
            <div
              className="rounded-card border p-4"
              style={{ borderColor: "var(--app-card-border)", background: "var(--app-card-soft)" }}
            >
              <p className="app-kicker mb-2 text-[10px]">Starting Point</p>
              <p className="app-heading text-sm leading-relaxed">
                Your first experience will be centered around practical spiritual support, prayerful reflection, and simple next steps.
              </p>
            </div>
          </div>

          <button
            onClick={handleGetStarted}
            className="touch-target app-primary-button flex w-full items-center justify-center rounded-pill py-4 font-semibold text-white transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Get Started
          </button>
        </motion.div>
      </div>
    );
  }

  const question = questions[currentStep];

  return (
    <div
      className="app-screen-scroll relative flex flex-col overflow-x-hidden px-4"
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "1.25rem" : "2rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "1.5rem" : "2.25rem"})`,
      }}
    >
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col">
        <div className={cn("flex items-center justify-between", isShortPhone ? "mb-6" : "mb-8 sm:mb-12")}>
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="touch-target app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="app-soft text-xs">
            {Object.keys(answers).length} answered
          </span>
        </div>

        <div className={cn("h-1 w-full overflow-hidden rounded-full", isShortPhone ? "mb-6" : "mb-8")} style={{ background: "var(--app-divider)" }}>
          <motion.div
            className="h-full"
            style={{ background: "var(--app-accent-gradient)" }}
            initial={{ width: 0 }}
            animate={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <span className={cn("app-kicker text-xs font-semibold", isShortPhone ? "mb-3" : "mb-4")}>
          Question {currentStep + 1} of {questions.length}
        </span>

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
            className="flex-1"
          >
            <h1 className={cn("app-heading mb-4 pb-1 font-serif leading-[1.24]", isCompactPhone ? "text-[2rem]" : "text-3xl sm:text-4xl")}>
              {question.title}
            </h1>
            <p className={cn("app-muted max-w-sm", isShortPhone ? "mb-7" : "mb-10")}>
              A few quick choices will help the app adapt its tone and first suggestions.
            </p>

            <div className={cn(isCompactPhone ? "space-y-3" : "space-y-4")}>
              {question.options.map((option) => {
                const isSelected = answers[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelect(option.id)}
                    className={`touch-target app-card-hover w-full rounded-card border text-left flex items-center justify-between transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] ${
                      isSelected
                        ? "shadow-[0_14px_34px_rgba(0,0,0,0.08)]"
                        : ""
                    } ${isCompactPhone ? "p-4" : "p-5"}`}
                    style={{
                      background: isSelected ? "var(--app-accent-soft)" : "var(--app-card-bg)",
                      borderColor: isSelected
                        ? "color-mix(in srgb, var(--app-accent) 38%, transparent)"
                        : "var(--app-card-border)",
                    }}
                  >
                    <div className="flex items-center gap-4">
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
                        className={cn(isCompactPhone ? "text-[16px]" : "text-lg")}
                        style={{
                          color: isSelected ? "var(--app-accent)" : "var(--app-text)",
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        {option.label}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
