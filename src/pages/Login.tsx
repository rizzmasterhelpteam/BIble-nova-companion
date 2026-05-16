import React, { useEffect, useState } from "react";
import { Mail, Lock, ArrowRight, X } from "lucide-react";
import { ChristianCross } from "../components/ChristianCross";
import { useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { cn, useDocumentTitle } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";

type LegalView = "terms" | "privacy";

const legalDocuments: Record<LegalView, { title: string; updatedAt: string; sections: { heading: string; body: string }[] }> = {
  terms: {
    title: "Terms & Conditions",
    updatedAt: "May 10, 2026",
    sections: [
      {
        heading: "Spiritual reflection only",
        body: "Bible Nova Companion offers Christian reflection, prayer support, and spiritual encouragement. It is not a substitute for emergency help, medical care, legal advice, mental health treatment, or sacramental guidance from a church leader.",
      },
      {
        heading: "Your responsibility",
        body: "Use the app thoughtfully and safely. Do not rely on AI responses as the only basis for serious personal, financial, legal, medical, or safety decisions.",
      },
      {
        heading: "Accounts and access",
        body: "You are responsible for keeping your account secure. Guest data is stored on this device and may be lost if local storage is cleared.",
      },
      {
        heading: "Acceptable use",
        body: "Do not misuse the app, attempt to disrupt the service, submit illegal or harmful content, or use the service in a way that violates another person's rights.",
      },
      {
        heading: "Subscriptions",
        body: "Paid access, trials, renewals, and cancellations are handled through the applicable app store or payment provider when billing is enabled.",
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    updatedAt: "May 10, 2026",
    sections: [
      {
        heading: "Information we handle",
        body: "The app may process your email, authentication profile, profile name, profile picture, chat messages, intentions, settings, and subscription status depending on how you use it.",
      },
      {
        heading: "How information is used",
        body: "Information is used to sign you in, personalize your experience, save your preferences, generate responses, maintain the service, and support account or safety features.",
      },
      {
        heading: "AI processing",
        body: "Messages you send for guidance may be sent to configured AI service providers to generate responses. Avoid sharing emergency details or information you do not want processed by those providers.",
      },
      {
        heading: "Local and account storage",
        body: "Guest reflections are stored locally on your device. Signed-in features may use configured authentication and server providers. You can clear local profile data from the app settings.",
      },
      {
        heading: "Sharing",
        body: "We do not sell your personal information. Data may be shared with service providers that operate the app, or when required for legal, security, or safety reasons.",
      },
    ],
  },
};

export default function Login() {
  useDocumentTitle("Sign in | Bible Nova Companion");
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [legalView, setLegalView] = useState<LegalView | null>(null);
  const navigate = useNavigate();
  const { user, isGuest, loginAsGuest } = useAuth();

  useEffect(() => {
    if (user || isGuest) {
      navigate("/");
    }
  }, [isGuest, navigate, user]);

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email || !password) return;

    setIsLoading(true);
    setError(null);

    try {
      if (mode === "signup") {
        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Failed to fetch") {
        setError(
          "Network error: Could not reach Supabase. Please confirm your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY settings.",
        );
      } else if (err instanceof Error) {
        setError(err.message || "An authentication error occurred.");
      } else {
        setError("An authentication error occurred.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: window.location.origin,
        },
      });
      if (error) throw error;
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "Failed to fetch") {
        setError(
          "Network error: Could not reach Supabase. Please confirm your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY settings.",
        );
      } else if (err instanceof Error) {
        setError(err.message || "An error occurred with Google sign-in.");
      } else {
        setError("An error occurred with Google sign-in.");
      }
      setIsLoading(false);
    }
  };

  return (
    <div
      className="app-screen-scroll relative flex flex-col"
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "1rem" : "1.5rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "1rem" : "1.5rem"})`,
      }}
    >
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-8%] top-[-12%] h-[24rem] w-[24rem]" />
        <div className="app-orb app-orb-b bottom-[-16%] right-[-8%] h-[26rem] w-[26rem]" />
      </div>

      <div
        className={cn(
          "relative z-10 flex flex-1 flex-col items-center px-4 py-4 sm:px-8",
          isShortPhone ? "justify-start" : "justify-center",
        )}
      >
        <div className={cn("app-logo-badge flex items-center justify-center rounded-full ring-1 ring-white/10", isShortPhone ? "mb-5 h-20 w-20" : "mb-6 h-24 w-24 sm:mb-10")}>
          <ChristianCross className="h-10 w-10 text-white" strokeWidth={2.5} />
        </div>

        <div className={cn("max-w-md text-center", isShortPhone ? "mb-6" : "mb-8 sm:mb-10")}>
          <p className="app-kicker mb-3">Premium Sanctuary</p>
          <h1 className={cn("app-heading mb-3 pb-1 font-serif font-normal leading-[1.24]", isCompactPhone ? "text-[2rem]" : "text-4xl")}>
            {mode === "login" ? "Welcome back" : "Find your peace"}
          </h1>
          <p className="app-muted px-2 text-[15px] leading-relaxed">
            {mode === "login"
              ? "A calmer, more premium Bible Nova Companion experience is ready."
              : "Create an account to keep your reflections across devices."}
          </p>
        </div>

        <div className={cn("w-full max-w-md", isShortPhone ? "space-y-4" : "space-y-5")}>
          {!isSupabaseConfigured && (
            <div className="app-panel rounded-card px-4 py-4 text-center text-sm leading-relaxed" style={{ color: "var(--app-accent)" }}>
              {supabaseConfigMessage} You can still continue as guest.
            </div>
          )}

          {error && (
            <div className="app-danger-panel rounded-card px-4 py-4 text-center text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleGoogleAuth}
            disabled={isLoading || !isSupabaseConfigured}
            className="touch-target app-secondary-button flex w-full items-center justify-center gap-3 rounded-card px-4 py-3.5 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            <span className="font-medium">Continue with Google</span>
          </button>

          <div className="relative flex items-center">
            <div className="flex-grow app-divider border-t" />
            <span className="mx-4 flex-shrink-0 text-xs font-medium uppercase tracking-[0.18em] app-soft">
              Or email
            </span>
            <div className="flex-grow app-divider border-t" />
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-4">
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 app-soft">
                  <Mail className="h-5 w-5" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Email address"
                  autoComplete="email"
                  enterKeyHint="next"
                  aria-label="Email address"
                  className="app-input w-full rounded-card py-3.5 pl-12 pr-4 text-[15px] transition-all"
                  required
                />
              </div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 app-soft">
                  <Lock className="h-5 w-5" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  enterKeyHint="go"
                  aria-label="Password"
                  minLength={mode === "signup" ? 6 : undefined}
                  className="app-input w-full rounded-card py-3.5 pl-12 pr-4 text-[15px] transition-all"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading || !isSupabaseConfigured}
              aria-busy={isLoading}
              className="touch-target app-primary-button flex w-full items-center justify-center gap-2 rounded-card py-4 font-medium text-white transition-all active:scale-[0.98] disabled:grayscale"
            >
              {isLoading ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <>
                  {mode === "login" ? "Sign in" : "Create account"}
                  <ArrowRight className="h-5 w-5" />
                </>
              )}
            </button>
          </form>

          <p className="app-muted pt-2 text-center text-sm">
            {mode === "login" ? "Do not have an account?" : "Already have an account?"}
            <button
              onClick={(event) => {
                event.preventDefault();
                setMode(mode === "login" ? "signup" : "login");
              }}
              className="ml-2 font-medium app-accent transition-colors hover:opacity-80"
            >
              {mode === "login" ? "Sign up" : "Sign in"}
            </button>
          </p>

          <div className="relative flex items-center pt-1">
            <div className="flex-grow app-divider border-t" />
            <span className="mx-4 flex-shrink-0 text-xs font-medium uppercase tracking-[0.18em] app-soft">
              Or
            </span>
            <div className="flex-grow app-divider border-t" />
          </div>

          <button
            onClick={() => {
              loginAsGuest();
              navigate("/");
            }}
            className="touch-target app-secondary-button w-full rounded-card py-3.5 text-[15px] font-medium transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Continue as guest
          </button>

          <p className="app-muted px-2 text-center text-[11px] leading-relaxed">
            By signing in, creating an account, or continuing as guest, you agree to our{" "}
            <button
              type="button"
              onClick={() => setLegalView("terms")}
              className="app-accent font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              Terms & Conditions
            </button>{" "}
            and{" "}
            <button
              type="button"
              onClick={() => setLegalView("privacy")}
              className="app-accent font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            >
              Privacy Policy
            </button>
            .
          </p>
        </div>
      </div>

      {legalView && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center px-4 pb-4 pt-safe sm:items-center sm:p-6">
          <button
            type="button"
            aria-label="Close legal information"
            onClick={() => setLegalView(null)}
            className="app-overlay absolute inset-0 backdrop-blur-sm"
          />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-dialog-title"
            className="app-panel-strong relative z-10 max-h-[82dvh] w-full max-w-md overflow-y-auto rounded-[2rem] border p-5 shadow-2xl scrollbar-hide sm:p-6"
            style={{ maxHeight: "calc(var(--app-visible-height) - 2rem)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="app-kicker mb-2">Legal</p>
                <h2 id="legal-dialog-title" className="app-heading text-xl font-semibold">
                  {legalDocuments[legalView].title}
                </h2>
                <p className="app-muted mt-1 text-[11px]">
                  Last updated {legalDocuments[legalView].updatedAt}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLegalView(null)}
                aria-label="Close legal information"
                className="app-secondary-button flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {legalDocuments[legalView].sections.map((section) => (
                <div key={section.heading}>
                  <h3 className="app-heading text-[14px] font-semibold">
                    {section.heading}
                  </h3>
                  <p className="app-muted mt-1 text-[12px] leading-relaxed">
                    {section.body}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
