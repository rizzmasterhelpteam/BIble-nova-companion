import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { PluginListenerHandle } from "@capacitor/core";
import { Keyboard, type KeyboardInfo } from "@capacitor/keyboard";
import { isNativePlatform } from "../lib/native/platform";

type MobileViewportState = {
  bottomInset: number;
  isCompactPhone: boolean;
  isKeyboardOpen: boolean;
  isShortPhone: boolean;
  keyboardHeight: number;
  visibleHeight: number;
  width: number;
};

const DEFAULT_VIEWPORT_HEIGHT =
  typeof window === "undefined" ? 0 : window.visualViewport?.height ?? window.innerHeight;
const DEFAULT_VIEWPORT_WIDTH =
  typeof window === "undefined" ? 0 : window.visualViewport?.width ?? window.innerWidth;

const initialState: MobileViewportState = {
  bottomInset: 0,
  isCompactPhone: DEFAULT_VIEWPORT_WIDTH > 0 && DEFAULT_VIEWPORT_WIDTH <= 380,
  isKeyboardOpen: false,
  isShortPhone: DEFAULT_VIEWPORT_HEIGHT > 0 && DEFAULT_VIEWPORT_HEIGHT <= 760,
  keyboardHeight: 0,
  visibleHeight: DEFAULT_VIEWPORT_HEIGHT,
  width: DEFAULT_VIEWPORT_WIDTH,
};

const MobileViewportContext = createContext<MobileViewportState>(initialState);

const KEYBOARD_OPEN_THRESHOLD = 120;
const MIN_VISIBLE_HEIGHT = 280;
const VIEWPORT_STATE_STEP = 8;

const round = (value: number) => Math.round(Math.max(0, value));
const quantize = (value: number) => Math.round(value / VIEWPORT_STATE_STEP) * VIEWPORT_STATE_STEP;

const getViewportMetrics = () => {
  const viewport = window.visualViewport;
  const layoutHeight = round(window.innerHeight);
  const rawVisibleHeight = round(viewport?.height ?? layoutHeight);

  return {
    layoutHeight,
    offsetTop: round(viewport?.offsetTop ?? 0),
    rawVisibleHeight,
    width: round(viewport?.width ?? window.innerWidth),
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
    let stableHeight = Math.max(window.innerHeight, window.visualViewport?.height ?? 0);
    let viewportFrame: number | null = null;
    let focusTimer: number | null = null;
    let appliedRootState: MobileViewportState | null = null;
    let publishedState: MobileViewportState | null = null;
    const listenerHandles: PluginListenerHandle[] = [];

    const clearFocusTimer = () => {
      if (focusTimer !== null) {
        window.clearTimeout(focusTimer);
        focusTimer = null;
      }
    };

    const scheduleFocusIntoView = () => {
      clearFocusTimer();
      focusTimer = window.setTimeout(() => {
        focusTimer = null;
        focusActiveElementIntoView();
      }, 80);
    };

    const syncViewport = () => {
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
      if (!areViewportStatesEqual(publishedState, nextPublishedState)) {
        publishedState = nextPublishedState;
        setState(nextPublishedState);
      }
    };

    const queueViewportSync = () => {
      if (viewportFrame !== null) return;

      viewportFrame = window.requestAnimationFrame(() => {
        viewportFrame = null;
        syncViewport();
      });
    };

    const handleKeyboardShow = (info: KeyboardInfo) => {
      const wasKeyboardOpen = keyboardOpen;
      keyboardHeight = round(info.keyboardHeight);
      keyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;
      queueViewportSync();
      if (!wasKeyboardOpen && keyboardOpen) {
        scheduleFocusIntoView();
      }
    };

    const handleKeyboardHide = () => {
      keyboardHeight = 0;
      keyboardOpen = false;
      queueViewportSync();
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
      } else if (!isNativePlatform() || !isEditableElementFocused()) {
        keyboardHeight = 0;
        keyboardOpen = false;
      }

      queueViewportSync();
    };

    syncViewport();
    window.addEventListener("resize", handleViewportChange, { passive: true });
    window.addEventListener("orientationchange", handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("resize", handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleViewportChange, { passive: true });

    if (isNativePlatform()) {
      void Promise.all([
        Keyboard.addListener("keyboardWillShow", handleKeyboardShow),
        Keyboard.addListener("keyboardDidShow", handleKeyboardShow),
        Keyboard.addListener("keyboardWillHide", handleKeyboardHide),
        Keyboard.addListener("keyboardDidHide", handleKeyboardHide),
      ]).then((handles) => {
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
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      window.visualViewport?.removeEventListener("resize", handleViewportChange);
      window.visualViewport?.removeEventListener("scroll", handleViewportChange);
      void Promise.all(listenerHandles.map((handle) => handle.remove()));
    };
  }, []);

  const value = useMemo(() => state, [state]);

  return (
    <MobileViewportContext.Provider value={value}>{children}</MobileViewportContext.Provider>
  );
}

export const useMobileViewport = () => useContext(MobileViewportContext);
