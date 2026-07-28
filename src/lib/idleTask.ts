type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

export const scheduleIdleTask = (
  callback: () => void,
  timeout = 1_000,
) => {
  const idleWindow = window as IdleWindow;

  if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
    const handle = idleWindow.requestIdleCallback(callback, { timeout });
    return () => idleWindow.cancelIdleCallback?.(handle);
  }

  const handle = window.setTimeout(callback, Math.min(timeout, 250));
  return () => window.clearTimeout(handle);
};
