export const shouldWaitForAndroidSubscriptionResolution = ({
  isAndroidNative,
  hasCompletedOnboarding,
  isSubscriptionResolved,
}: {
  isAndroidNative: boolean;
  hasCompletedOnboarding: boolean;
  isSubscriptionResolved: boolean;
}) => isAndroidNative && hasCompletedOnboarding && !isSubscriptionResolved;

export const shouldRedirectAndroidToPaywall = ({
  isAndroidNative,
  hasCompletedOnboarding,
  isSubscribed,
  pathname,
}: {
  isAndroidNative: boolean;
  hasCompletedOnboarding: boolean;
  isSubscribed: boolean;
  pathname: string;
}) =>
  isAndroidNative &&
  hasCompletedOnboarding &&
  !isSubscribed &&
  pathname !== "/paywall";
