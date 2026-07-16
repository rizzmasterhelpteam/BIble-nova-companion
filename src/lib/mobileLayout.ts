export type ChatScrollBehavior = "auto" | "smooth";

/** Keep the composer anchored while the keyboard or an in-flight response changes layout. */
export const getChatScrollBehavior = (
  isKeyboardOpen: boolean,
  messageCountChanged: boolean,
): ChatScrollBehavior => {
  return !isKeyboardOpen && messageCountChanged ? "smooth" : "auto";
};

/** A visible keyboard must remove the bottom navigation from the hit-test area. */
export const shouldHideBottomNavigation = (isKeyboardOpen: boolean) => isKeyboardOpen;
