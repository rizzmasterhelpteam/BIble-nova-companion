import React, { useEffect, useRef, useState } from "react";
import { Mail, Lock, ArrowRight, ShieldCheck, X, Eye, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { isSupabaseConfigured, supabase, supabaseConfigMessage } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { cn, useDocumentTitle } from "../lib/utils";
import { useMobileViewport } from "../context/MobileViewportContext";
import { signInWithGoogleNative } from "../lib/native/auth";
import { isNativePlatform } from "../lib/native/platform";
import { AppLogo } from "../components/AppLogo";

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
        body: "You are responsible for keeping your account secure and for maintaining access to the email or identity provider attached to your account.",
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
        body: "Signed-in features may use configured authentication and server providers. You can clear local profile data from the app settings.",
      },
      {
        heading: "Sharing",
        body: "We do not sell your personal information. Data may be shared with service providers that operate the app, or when required for legal, security, or safety reasons.",
      },
    ],
  },
};

const getCalmAuthError = (error: unknown, provider: "email" | "google") => {
  if (!(error instanceof Error)) {
    return provider === "google"
      ? "Google sign-in could not be completed. Please try again."
      : "We could not sign you in. Please check your details and try again.";
  }

  const message = error.message.toLowerCase();
  if (message.includes("cancel") || message.includes("closed")) {
    return "Sign-in was canceled. You can try again whenever you’re ready.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "We could not connect right now. Check your internet connection and try again.";
  }
  if (message.includes("invalid login") || message.includes("invalid credentials")) {
    return "That email or password does not match. Please try again.";
  }
  if (message.includes("already registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }

  return provider === "google"
    ? "Google sign-in could not be completed. Please try again."
    : "We could not complete that request. Please try again.";
};

export default function Login() {
  useDocumentTitle("Sign in | Bible Nova Companion");
  const { isCompactPhone, isKeyboardOpen, isShortPhone } = useMobileViewport();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [legalView, setLegalView] = useState<LegalView | null>(null);
  const legalDialogRef = useRef<HTMLElement>(null);
  const legalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading, hasCompletedOnboarding } = useAuth();
  const shouldTopAlign = isShortPhone || isKeyboardOpen;
  const authTitle = mode === "login" ? "Sign in" : "Create account";
  const authSubtitle = mode === "login"
    ? "Return to a quiet space for scripture, prayer, and honest reflection."
    : "Create your private reflection space and carry it with you.";

  useEffect(() => {
    if (isAuthLoading) return;

    if (user) {
      const destination = !hasCompletedOnboarding ? "/onboarding" : "/";
      navigate(destination, { replace: true });
    }
  }, [hasCompletedOnboarding, isAuthLoading, navigate, user]);

  useEffect(() => {
    if (!legalView) return;

    const originalOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => legalDialogRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLegalView(null);
        return;
      }

      if (event.key !== "Tab" || !legalDialogRef.current) return;
      const focusable: HTMLElement[] = [
        ...legalDialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => !element.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      (legalTriggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [legalView]);

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading || isAuthLoading) return;
    if (!email || !password) return;
    if (!isSupabaseConfigured) {
      setError(supabaseConfigMessage);
      return;
    }

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
      setError(getCalmAuthError(err, "email"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    if (isLoading || isAuthLoading) return;
    if (!isSupabaseConfigured) {
      setError(supabaseConfigMessage);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      if (isNativePlatform()) {
        await signInWithGoogleNative();
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: new URL("/login", window.location.origin).toString(),
          },
        });
        if (error) throw error;
      }
    } catch (err: unknown) {
      setError(getCalmAuthError(err, "google"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="app-screen-scroll sanctuary-screen w-full relative flex flex-col"
      style={{
        paddingTop: `max(env(safe-area-inset-top, 0px), ${isShortPhone ? "1rem" : "1.5rem"})`,
        paddingBottom: `max(env(safe-area-inset-bottom, 0px), ${isShortPhone ? "1rem" : "1.5rem"})`,
      }}
    >
      <div className="sanctuary-atmosphere" />

      <div className={cn(
        "relative z-10 mx-auto flex w-full max-w-md flex-1 px-4 py-4 sm:px-6",
        shouldTopAlign ? "items-start" : "items-center"
      )}>
        <section
          className={cn(
            "sanctuary-surface shrink-0 w-full rounded-[1.75rem] px-5 py-6 sm:px-7 sm:py-8",
            !shouldTopAlign && "my-auto",
          )}
          style={{ borderColor: "var(--app-card-border)" }}
        >
          <div className="mb-6">
            {/* Brand mark */}
            <div className="mb-5 flex justify-center">
              <div className="sanctuary-brand-mark h-16 w-16">
                <AppLogo className="h-full w-full object-cover" />
              </div>
            </div>
            <p className="app-kicker mb-2 text-center">Bible Nova Companion</p>
            <h1 className={cn("app-heading text-center font-serif leading-tight", isCompactPhone ? "text-[2rem]" : "text-[2.25rem]")}>{authTitle}</h1>
            <p className="app-muted mx-auto mt-2 max-w-sm text-center text-sm leading-relaxed">{authSubtitle}</p>
          </div>

          <div className={cn("w-full", isShortPhone ? "space-y-4" : "space-y-5")}>
        {!isSupabaseConfigured && (
          <div className="app-panel rounded-card px-4 py-4 text-center text-sm leading-relaxed" style={{ color: "var(--app-accent)" }}>
            {supabaseConfigMessage}
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
          className="touch-target app-primary-button flex w-full items-center justify-center gap-3 rounded-card px-4 py-4 transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] active:scale-[0.98]"
          style={{
            boxShadow: "0 8px 24px rgba(0,0,0,0.08), inset 0 1px 0 rgba(255,255,255,0.12)",
          }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          <span className="font-semibold">Continue with Google</span>
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
                id="login-email"
                name="email"
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
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                enterKeyHint="go"
                aria-label="Password"
                minLength={mode === "signup" ? 6 : undefined}
                className="app-input w-full rounded-card py-3.5 pl-12 pr-12 text-[15px] transition-all"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="app-ghost-button absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading || !isSupabaseConfigured}
            aria-busy={isLoading}
            className="touch-target app-secondary-button flex w-full items-center justify-center gap-2 rounded-card py-4 font-semibold transition-all active:scale-[0.98] disabled:opacity-60"
          >
            {isLoading ? (
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-current/25 border-t-current" />
            ) : (
              <>
                {mode === "login" ? "Sign in" : "Create account"}
                <ArrowRight className="h-5 w-5" />
              </>
            )}
          </button>
        </form>

        <div className="app-success-panel flex items-start gap-2.5 rounded-card px-3.5 py-3 text-xs leading-relaxed">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--app-success)" }} />
          <span>Your reflections stay connected to your account and are never sold.</span>
        </div>

        <p className="app-muted pt-2 text-center text-sm">
          {mode === "login" ? "Need an account?" : "Already have an account?"}
          <button
            onClick={(event) => {
              event.preventDefault();
              setMode(mode === "login" ? "signup" : "login");
            }}
            className="ml-2 font-semibold app-accent transition-colors hover:opacity-80 relative after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:rounded-full after:bg-current after:scale-x-0 hover:after:scale-x-100 after:transition-transform after:duration-200 after:origin-left"
          >
            {mode === "login" ? "Sign up" : "Sign in"}
          </button>
        </p>

        <p className="app-muted px-2 text-center text-[11px] leading-relaxed">
          By signing in or creating an account, you agree to our{" "}
          <button
            type="button"
            onClick={(event) => {
              legalTriggerRef.current = event.currentTarget;
              setLegalView("terms");
            }}
            className="app-accent font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Terms & Conditions
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={(event) => {
              legalTriggerRef.current = event.currentTarget;
              setLegalView("privacy");
            }}
            className="app-accent font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            Privacy Policy
          </button>
          .
        </p>
          </div>
        </section>
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
            ref={legalDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-dialog-title"
            tabIndex={-1}
            className="sanctuary-surface relative z-10 max-h-[82dvh] w-full max-w-md overflow-y-auto rounded-[1.75rem] p-5 shadow-2xl scrollbar-hide sm:p-6 focus:outline-none"
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
