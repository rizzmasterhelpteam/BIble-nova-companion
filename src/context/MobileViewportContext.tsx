import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import type { KeyboardInfo } from "@capacitor/keyboard";
import { getPlatformAdapter, isNativePlatform } from "../lib/native/platform";

type MobileViewportState = {
  bottomInset: number;
  isCompactPhone: boolean;
  isKeyboardOpen: boolean;
  isShortPhone: boolean;
  keyboardHeight: number;
  visibleHeight: number;
  width: number;
};

type MobileViewportContextValue = MobileViewportState & {
  resetKeyboardState: () => void;
};

const MIN_STARTUP_VIEWPORT_HEIGHT = 320;
const MIN_STARTUP_VIEWPORT_WIDTH = 320;

const DEFAULT_VIEWPORT_HEIGHT =
  typeof window === "undefined"
    ? MIN_STARTUP_VIEWPORT_HEIGHT
    : Math.max(
        MIN_STARTUP_VIEWPORT_HEIGHT,
        window.visualViewport?.height || window.innerHeight || MIN_STARTUP_VIEWPORT_HEIGHT,
      );
const DEFAULT_VIEWPORT_WIDTH =
  typeof window === "undefined"
    ? MIN_STARTUP_VIEWPORT_WIDTH
    : Math.max(
        MIN_STARTUP_VIEWPORT_WIDTH,
        window.visualViewport?.width || window.innerWidth || MIN_STARTUP_VIEWPORT_WIDTH,
      );

const initialState: MobileViewportState = {
  bottomInset: 0,
  isCompactPhone: DEFAULT_VIEWPORT_WIDTH > 0 && DEFAULT_VIEWPORT_WIDTH <= 380,
  isKeyboardOpen: false,
  isShortPhone: DEFAULT_VIEWPORT_HEIGHT > 0 && DEFAULT_VIEWPORT_HEIGHT <= 760,
  keyboardHeight: 0,
  visibleHeight: DEFAULT_VIEWPORT_HEIGHT,
  width: DEFAULT_VIEWPORT_WIDTH,
};

const MobileViewportContext = createContext<MobileViewportContextValue>({
  ...initialState,
  resetKeyboardState: () => {},
});

const KEYBOARD_OPEN_THRESHOLD = 120;
const MIN_VISIBLE_HEIGHT = 280;
const VIEWPORT_STATE_STEP = 8;
const VIEWPORT_PUBLISH_DELAY_MS = 140;

const round = (value: number) => Math.round(Math.max(0, value));
const quantize = (value: number) => Math.round(value / VIEWPORT_STATE_STEP) * VIEWPORT_STATE_STEP;

const getViewportMetrics = () => {
  const viewport = window.visualViewport;
  const layoutHeight = Math.max(
    MIN_VISIBLE_HEIGHT,
    round(window.innerHeight || viewport?.height || DEFAULT_VIEWPORT_HEIGHT),
  );
  const rawVisibleHeight = Math.max(
    MIN_VISIBLE_HEIGHT,
    round(viewport?.height || layoutHeight),
  );

  return {
    layoutHeight,
    offsetTop: round(viewport?.offsetTop ?? 0),
    rawVisibleHeight,
    width: Math.max(1, round(viewport?.width || window.innerWidth || DEFAULT_VIEWPORT_WIDTH)),
  };
};

const isEditableElementFocused = () => {
  if (typeof document === "undefined") return false;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;

  const tagName = activeElement.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    activeElement.isContentEditable
  );
};

const focusActiveElementIntoView = () => {
  if (typeof document === "undefined") return;

  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement) || !isEditableElementFocused()) return;

  activeElement.scrollIntoView({ block: "nearest", inline: "nearest" });
};

const applyRootViewportState = (state: MobileViewportState) => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.style.setProperty("--app-visible-height", `${state.visibleHeight}px`);
  root.style.setProperty("--app-viewport-width", `${state.width}px`);
  root.style.setProperty("--app-keyboard-height", `${state.keyboardHeight}px`);
  root.style.setProperty("--app-bottom-offset", `${state.bottomInset}px`);
  root.classList.toggle("keyboard-open", state.isKeyboardOpen);
  root.classList.toggle("compact-phone", state.isCompactPhone);
  root.classList.toggle("short-phone", state.isShortPhone);
};

const getPublishedViewportState = (state: MobileViewportState): MobileViewportState => ({
  ...state,
  bottomInset: quantize(state.bottomInset),
  keyboardHeight: quantize(state.keyboardHeight),
  visibleHeight: quantize(state.visibleHeight),
  width: quantize(state.width),
});

const areViewportStatesEqual = (
  previous: MobileViewportState | null,
  next: MobileViewportState,
) => {
  if (!previous) return false;
  return (
    previous.bottomInset === next.bottomInset &&
    previous.isCompactPhone === next.isCompactPhone &&
    previous.isKeyboardOpen === next.isKeyboardOpen &&
    previous.isShortPhone === next.isShortPhone &&
    previous.keyboardHeight === next.keyboardHeight &&
    previous.visibleHeight === next.visibleHeight &&
    previous.width === next.width
  );
};

const areViewportSemanticsEqual = (
  previous: MobileViewportState | null,
  next: MobileViewportState,
) =>
  Boolean(
    previous &&
      previous.isCompactPhone === next.isCompactPhone &&
      previous.isKeyboardOpen === next.isKeyboardOpen &&
      previous.isShortPhone === next.isShortPhone,
  );

const buildViewportState = (
  keyboardHeight: number,
  isKeyboardOpen: boolean,
  stableHeight: number,
): MobileViewportState => {
  const { layoutHeight, offsetTop, rawVisibleHeight, width } = getViewportMetrics();
  const viewportInset = round(layoutHeight - rawVisibleHeight - offsetTop);
  const stableInset = round(stableHeight - rawVisibleHeight - offsetTop);
  const layoutViewportShrunk =
    isKeyboardOpen && stableHeight - layoutHeight > KEYBOARD_OPEN_THRESHOLD;
  const effectiveKeyboardHeight = isKeyboardOpen
    ? Math.max(keyboardHeight, viewportInset, stableInset)
    : 0;
  const keyboardOverlaysViewport = isKeyboardOpen && !layoutViewportShrunk;
  const visibleHeight = isKeyboardOpen
    ? Math.max(
        MIN_VISIBLE_HEIGHT,
        layoutViewportShrunk
          ? Math.min(rawVisibleHeight, layoutHeight)
          : Math.min(
              rawVisibleHeight,
              stableHeight - effectiveKeyboardHeight || rawVisibleHeight,
            ),
      )
    : rawVisibleHeight;

  return {
    bottomInset: keyboardOverlaysViewport ? effectiveKeyboardHeight : 0,
    isCompactPhone: width > 0 && width <= 380,
    isKeyboardOpen,
    isShortPhone: stableHeight > 0 && stableHeight <= 760,
    keyboardHeight: effectiveKeyboardHeight,
    visibleHeight,
    width,
  };
};

export function MobileViewportProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let isDisposed = false;
    let keyboardHeight = 0;
    let keyboardOpen = false;
    let stableHeight = Math.max(
      MIN_VISIBLE_HEIGHT,
      window.innerHeight || 0,
      window.visualViewport?.height || 0,
    );
    let viewportFrame: number | null = null;
    let focusTimer: number | null = null;
    let publishTimer: number | null = null;
    let forcePublishOnNextFrame = false;
    let appliedRootState: MobileViewportState | null = null;
    let publishedState: MobileViewportState | null = null;
    let pendingPublishedState: MobileViewportState | null = null;
    let keyboardRecoveryTimer: number | null = null;
    const listenerHandles: PluginListenerHandle[] = [];
    let removeAppStateListener: (() => void) | undefined;

    const clearFocusTimer = () => {
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
        focusTimer = null;
      }
    };

    const clearKeyboardRecoveryTimer = () => {
      if (keyboardRecoveryTimer !== null) {
        window.clearTimeout(keyboardRecoveryTimer);
        keyboardRecoveryTimer = null;
      }
    };

    const scheduleFocusIntoView = () => {
      clearFocusTimer();
      focusTimer = window.setTimeout(() => {
        focusTimer = null;
        focusActiveElementIntoView();
      }, 80);
    };

    const clearPublishTimer = () => {
      if (publishTimer !== null) {
        window.clearTimeout(publishTimer);
        publishTimer = null;
      }
    };

    const publishViewportState = (nextState: MobileViewportState) => {
      pendingPublishedState = null;
      if (areViewportStatesEqual(publishedState, nextState)) return;
      publishedState = nextState;
      setState(nextState);
    };

    const scheduleStablePublish = (nextState: MobileViewportState) => {
      pendingPublishedState = nextState;
      clearPublishTimer();
      publishTimer = window.setTimeout(() => {
        publishTimer = null;
        if (!isDisposed && pendingPublishedState) {
          publishViewportState(pendingPublishedState);
        }
      }, VIEWPORT_PUBLISH_DELAY_MS);
    };

    const syncViewport = (forcePublish = false) => {
      const metrics = getViewportMetrics();
      if (!keyboardOpen) {
        stableHeight = Math.max(metrics.layoutHeight, metrics.rawVisibleHeight);
      }

      const nextRootState = buildViewportState(keyboardHeight, keyboardOpen, stableHeight);
      if (isDisposed) return;

      if (!areViewportStatesEqual(appliedRootState, nextRootState)) {
        appliedRootState = nextRootState;
        applyRootViewportState(nextRootState);
      }

      const nextPublishedState = getPublishedViewportState(nextRootState);
      if (forcePublish || !areViewportSemanticsEqual(publishedState, nextPublishedState)) {
        clearPublishTimer();
        publishViewportState(nextPublishedState);
      } else if (!areViewportStatesEqual(publishedState, nextPublishedState)) {
        scheduleStablePublish(nextPublishedState);
      }
    };

    const queueViewportSync = (forcePublish = false) => {
      forcePublishOnNextFrame = forcePublishOnNextFrame || forcePublish;
      if (viewportFrame !== null) return;

      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = null;
        const shouldForcePublish = forcePublishOnNextFrame;
        forcePublishOnNextFrame = false;
        syncViewport(shouldForcePublish);
      });
    };

    const handleKeyboardShow = (info: KeyboardInfo) => {
      const wasKeyboardOpen = keyboardOpen;
      keyboardHeight = round(info.keyboardHeight);
      keyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;
      queueViewportSync(true);
      if (!wasKeyboardOpen && keyboardOpen) {
        scheduleFocusIntoView();
      }
      clearKeyboardRecoveryTimer();
      if (keyboardOpen) {
        keyboardRecoveryTimer = window.setTimeout(() => {
          keyboardRecoveryTimer = null;
          if (keyboardOpen && !isEditableElementFocused()) handleKeyboardHide();
        }, 10_000);
      }
    };

    const handleKeyboardHide = () => {
      clearKeyboardRecoveryTimer();
      keyboardHeight = 0;
      keyboardOpen = false;
      queueViewportSync(true);
    };

    const handleViewportChange = () => {
      const metrics = getViewportMetrics();
      const wasKeyboardOpen = keyboardOpen;
      const inferredInset = Math.max(
        round(metrics.layoutHeight - metrics.rawVisibleHeight - metrics.offsetTop),
        round(stableHeight - metrics.rawVisibleHeight - metrics.offsetTop),
      );

      if (
        inferredInset > KEYBOARD_OPEN_THRESHOLD &&
        (keyboardOpen || isEditableElementFocused())
      ) {
        keyboardHeight = Math.max(keyboardHeight, inferredInset);
        keyboardOpen = true;
        if (!wasKeyboardOpen) {
          scheduleFocusIntoView();
        }
        clearKeyboardRecoveryTimer();
        keyboardRecoveryTimer = window.setTimeout(() => {
          keyboardRecoveryTimer = null;
          if (keyboardOpen && !isEditableElementFocused()) handleKeyboardHide();
        }, 10_000);
      } else if (!isNativePlatform() || !isEditableElementFocused()) {
        clearKeyboardRecoveryTimer();
        keyboardHeight = 0;
        keyboardOpen = false;
      }

      queueViewportSync();
    };

    // Scrolling a long chat can emit visualViewport scroll events every frame.
    // The viewport state only needs that signal while the keyboard or a form
    // control is active, so avoid layout reads during normal content scrolling.
    const handleViewportScroll = () => {
      if (keyboardOpen || isEditableElementFocused()) {
        handleViewportChange();
      }
    };

    const handleOrientationChange = () => {
      queueViewportSync(true);
    };

    const handleFocusChange = () => {
      if (keyboardOpen && !isEditableElementFocused()) handleKeyboardHide();
    };

    const handleExternalKeyboardReset = () => handleKeyboardHide();

    syncViewport(true);
    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleOrientationChange, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleViewportScroll, { passive: true });
    window.addEventListener("focusout", handleFocusChange);
    window.addEventListener("bible-nova-keyboard-reset", handleExternalKeyboardReset);

    if (isNativePlatform()) {
      removeAppStateListener = getPlatformAdapter().appState.subscribe(({ active }) => {
        if (active && !isEditableElementFocused()) handleKeyboardHide();
      });
      void import("@capacitor/keyboard").then(({ Keyboard }) => Promise.all([
        Keyboard.addListener("keyboardDidShow", handleKeyboardShow),
        Keyboard.addListener("keyboardDidHide", handleKeyboardHide),
      ])).then((handles) => {
        if (isDisposed) {
          void Promise.all(handles.map((handle) => handle.remove()));
          return;
        }

        listenerHandles.push(...handles);
      });
    }

    return () => {
      isDisposed = true;
      if (viewportFrame !== null) {
        window.cancelAnimationFrame(viewportFrame);
      }
      clearFocusTimer();
      clearPublishTimer();
      clearKeyboardRecoveryTimer();
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportScroll);
      window.removeEventListener("focusout", handleFocusChange);
      window.removeEventListener("bible-nova-keyboard-reset", handleExternalKeyboardReset);
      removeAppStateListener?.();
      void Promise.all(listenerHandles.map((handle) => handle.remove()));
    };
  }, []);

  const resetKeyboardState = React.useCallback(() => {
    window.dispatchEvent(new Event("bible-nova-keyboard-reset"));
  }, []);
  const value = useMemo(() => ({ ...state, resetKeyboardState }), [resetKeyboardState, state]);

  return (
    <MobileViewportContext.Provider value={value}>{children}</MobileViewportContext.Provider>
  );
}

export const useMobileViewport = () => useContext(MobileViewportContext);
