type StartupStage =
  | "index-loaded"
  | "main-evaluated"
  | "react-root-mounted"
  | "app-mounted"
  | "theme-bootstrap-applied"
  | "react-boot-shell-mounted"
  | "react-boot-shell-painted"
  | "first-frame-painted"
  | "session-resolution-started"
  | "session-resolution-completed"
  | "auth-initial-resolved"
  | "subscription-initial-resolved"
  | "initial-route-ready"
  | "native-initialization-failed"
  | "native-splash-hide-start"
  | "native-splash-hide-complete"
  | "native-splash-safety-timeout"
  | "native-splash-hidden"
  | "root-element-missing"
  | "react-root-mount"
  | "startup-failure";

type StartupState = {
  id: string;
  startedAt: number;
  stage: StartupStage | string;
  reactMounted?: boolean;
};

type StartupWindow = Window & {
  __BIBLE_NOVA_STARTUP__?: StartupState;
  Capacitor?: {
    Plugins?: {
      SplashScreen?: {
        hide?: () => Promise<void>;
      };
    };
  };
};

const createStartupId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `startup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getStartupState = (): StartupState => {
  if (typeof window === "undefined") {
    return {
      id: createStartupId(),
      startedAt: Date.now(),
      stage: "server",
    };
  }

  const startupWindow = window as StartupWindow;
  startupWindow.__BIBLE_NOVA_STARTUP__ ||= {
    id: createStartupId(),
    startedAt: Date.now(),
    stage: "main-evaluated",
  };

  return startupWindow.__BIBLE_NOVA_STARTUP__;
};

const hideNativeSplashFromFallback = () => {
  if (typeof window === "undefined") return;

  const splashScreen = (window as StartupWindow).Capacitor?.Plugins?.SplashScreen;
  if (typeof splashScreen?.hide === "function") {
    void splashScreen.hide().catch(() => undefined);
  }
};

const showFallbackRecovery = (stage: string) => {
  if (typeof document === "undefined") return;

  const fallback = document.getElementById("initial-app-shell");
  const message = document.getElementById("startup-fallback-message");
  const retry = document.getElementById("startup-retry");
  const startupId = document.getElementById("startup-fallback-id");

  fallback?.classList.add("startup-fallback-visible");
  fallback?.removeAttribute("hidden");
  fallback?.setAttribute("aria-busy", "false");
  if (message) {
    message.textContent = "Bible Nova could not start. Please retry.";
  }
  if (retry) {
    retry.removeAttribute("hidden");
  }
  if (startupId) {
    startupId.textContent = `Diagnostic ID: ${getStartupState().id}`;
    startupId.removeAttribute("hidden");
  }

  document.documentElement.dataset.startupStage = stage;
  hideNativeSplashFromFallback();
};

const state = getStartupState();

export const startup = {
  id: state.id,

  mark(stage: StartupStage) {
    state.stage = stage;
    if (stage === "react-root-mounted") {
      state.reactMounted = true;
    }

    if (typeof document !== "undefined") {
      document.documentElement.dataset.startupStage = stage;
    }

    console.info(`[Bible Nova startup] ${stage} (${state.id})`);
  },

  fail(stage: "root-element-missing" | "react-root-mount") {
    state.stage = stage;
    state.reactMounted = false;
    console.error(`[Bible Nova startup] failure at ${stage} (${state.id})`);
    showFallbackRecovery(stage);
  },
};
