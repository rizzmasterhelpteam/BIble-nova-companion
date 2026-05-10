import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Brain, Sparkles, Heart, ArrowLeft, ShieldCheck, Sunrise } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { motion, AnimatePresence } from "motion/react";
import { useDocumentTitle } from "../lib/utils";

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
      <div className="app-screen relative flex min-h-[100svh] flex-col items-center justify-center overflow-y-auto p-6 scrollbar-hide">
        <div className="app-atmosphere">
          <div className="app-grid" />
          <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
          <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="app-panel relative z-10 w-full max-w-md rounded-[2rem] p-6 shadow-2xl sm:p-8"
        >
          <button
            onClick={handleBack}
            className="app-ghost-button mb-6 inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>

          <div className="mb-7 flex justify-center">
            <div className="app-logo-badge flex h-20 w-20 items-center justify-center rounded-full ring-1 ring-white/10">
              <ChristianCross className="h-9 w-9 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <div className="text-center">
            <p className="app-kicker mb-3">Your Reflection Analysis</p>
            <h2 className="app-heading mb-4 pb-1 font-serif text-3xl leading-[1.24]">
              Your path is taking shape.
            </h2>
            <p className="app-muted mx-auto mb-6 max-w-sm text-[15px] leading-relaxed">
              Bible Nova Companion will focus on {reason}, help you move toward {goal}, and respond with {support} when you need it most.
            </p>
          </div>

          <div className="mb-7 space-y-3">
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
            className="app-primary-button flex w-full items-center justify-center rounded-pill py-4 font-semibold text-white transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
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
      className="app-screen relative flex min-h-[100svh] flex-col overflow-hidden px-6"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 4rem)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 4rem)",
      }}
    >
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-20%] h-[26rem] w-[26rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-10%] h-[28rem] w-[28rem]" />
      </div>

      <div className="w-full max-w-md mx-auto flex-1 flex flex-col relative z-10">
        <div className="flex items-center justify-between mb-8 sm:mb-12">
          <button
            onClick={handleBack}
            disabled={currentStep === 0}
            className="app-ghost-button inline-flex items-center gap-2 rounded-pill px-3 py-2 text-sm disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="app-soft text-xs">
            {Object.keys(answers).length} answered
          </span>
        </div>

        <div className="mb-8 h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--app-divider)" }}>
          <motion.div
            className="h-full"
            style={{ background: "var(--app-accent-gradient)" }}
            initial={{ width: 0 }}
            animate={{ width: `${((currentStep + 1) / questions.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <span className="app-kicker mb-4 text-xs font-semibold">
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
            <h1 className="app-heading mb-4 pb-1 text-3xl font-serif leading-[1.24] sm:text-4xl">
              {question.title}
            </h1>
            <p className="app-muted mb-10 max-w-sm">
              A few quick choices will help the app adapt its tone and first suggestions.
            </p>

            <div className="space-y-4">
              {question.options.map((option) => {
                const isSelected = answers[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    onClick={() => handleSelect(option.id)}
                    className={`app-card-hover w-full rounded-card border p-5 text-left flex items-center justify-between transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] ${
                      isSelected
                        ? "shadow-[0_14px_34px_rgba(0,0,0,0.08)]"
                        : ""
                    }`}
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
                        className="text-lg"
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
