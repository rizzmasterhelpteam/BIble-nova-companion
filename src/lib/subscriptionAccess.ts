export const shouldWaitForSubscriptionResolution = ({
  hasCompletedOnboarding,
  isSubscriptionResolved,
}: {
  hasCompletedOnboarding: boolean;
  isSubscriptionResolved: boolean;
}) => hasCompletedOnboarding && !isSubscriptionResolved;

export const shouldRedirectToPaywall = ({
  hasCompletedOnboarding,
  isSubscribed,
  pathname,
}: {
  hasCompletedOnboarding: boolean;
  isSubscribed: boolean;
  pathname: string;
}) =>
  hasCompletedOnboarding &&
  !isSubscribed &&
  pathname !== "/paywall";
