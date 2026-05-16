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

const round = (value: number) => Math.round(Math.max(0, value));

const applyRootViewportState = (state: MobileViewportState) => {
  const root = document.documentElement;
  root.style.setProperty("--app-visible-height", `${state.visibleHeight}px`);
  root.style.setProperty("--app-viewport-width", `${state.width}px`);
  root.style.setProperty("--app-keyboard-height", `${state.keyboardHeight}px`);
  root.style.setProperty("--app-bottom-offset", `${state.bottomInset}px`);
  root.classList.toggle("keyboard-open", state.isKeyboardOpen);
  root.classList.toggle("compact-phone", state.isCompactPhone);
  root.classList.toggle("short-phone", state.isShortPhone);
};

const buildViewportState = (
  keyboardHeight: number,
  isKeyboardOpen: boolean,
): MobileViewportState => {
  const viewport = window.visualViewport;
  const width = round(viewport?.width ?? window.innerWidth);
  const layoutHeight = round(window.innerHeight);
  const rawVisibleHeight = round(viewport?.height ?? layoutHeight);
  const viewportInset = round(layoutHeight - rawVisibleHeight - (viewport?.offsetTop ?? 0));
  const effectiveKeyboardHeight = isKeyboardOpen ? Math.max(keyboardHeight, viewportInset) : 0;
  const visibleHeight = effectiveKeyboardHeight
    ? Math.max(
        MIN_VISIBLE_HEIGHT,
        Math.min(rawVisibleHeight, layoutHeight - effectiveKeyboardHeight),
      )
    : rawVisibleHeight;

  return {
    bottomInset: effectiveKeyboardHeight || viewportInset,
    isCompactPhone: width > 0 && width <= 380,
    isKeyboardOpen,
    isShortPhone: visibleHeight > 0 && visibleHeight <= 760,
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
    const listenerHandles: PluginListenerHandle[] = [];

    const syncViewport = () => {
      const nextState = buildViewportState(keyboardHeight, keyboardOpen);
      if (isDisposed) return;

      applyRootViewportState(nextState);
      setState((current) => {
        if (
          current.bottomInset === nextState.bottomInset &&
          current.isCompactPhone === nextState.isCompactPhone &&
          current.isKeyboardOpen === nextState.isKeyboardOpen &&
          current.isShortPhone === nextState.isShortPhone &&
          current.keyboardHeight === nextState.keyboardHeight &&
          current.visibleHeight === nextState.visibleHeight &&
          current.width === nextState.width
        ) {
          return current;
        }
        return nextState;
      });
    };

    const handleKeyboardShow = (info: KeyboardInfo) => {
      keyboardHeight = round(info.keyboardHeight);
      keyboardOpen = keyboardHeight > KEYBOARD_OPEN_THRESHOLD;
      syncViewport();
    };

    const handleKeyboardHide = () => {
      keyboardHeight = 0;
      keyboardOpen = false;
      syncViewport();
    };

    const handleViewportChange = () => {
      const viewport = window.visualViewport;
      if (!keyboardOpen && viewport) {
        const layoutHeight = round(window.innerHeight);
        const inferredInset = round(
          layoutHeight - round(viewport.height) - (viewport.offsetTop ?? 0),
        );

        if (inferredInset > KEYBOARD_OPEN_THRESHOLD) {
          keyboardHeight = inferredInset;
          keyboardOpen = true;
        } else if (!isNativePlatform()) {
          keyboardHeight = 0;
          keyboardOpen = false;
        }
      }

      syncViewport();
    };

    syncViewport();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    window.visualViewport?.addEventListener("resize", handleViewportChange);
    window.visualViewport?.addEventListener("scroll", handleViewportChange);

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
