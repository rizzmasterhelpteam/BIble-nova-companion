import { storageGet, storageGetJson, storageRemove, storageSet } from "./webStorage";

export const LEGACY_ONBOARDING_DRAFT_KEY = "bible_nova_companion_onboarding_answers";
export const getOnboardingDraftKey = (userId: string) =>
  `bible-nova-companion-onboarding-answers-${userId}`;

export const loadOnboardingDraft = (userId: string) => {
  const key = getOnboardingDraftKey(userId);
  if (storageGet(key) !== null) return storageGetJson<Record<string, string>>(key, {});
  const legacy = storageGet(LEGACY_ONBOARDING_DRAFT_KEY);
  if (legacy === null) return {};
  storageSet(key, legacy);
  storageRemove(LEGACY_ONBOARDING_DRAFT_KEY);
  return storageGetJson<Record<string, string>>(key, {});
};

export const saveOnboardingDraft = (userId: string, answers: Record<string, string>) =>
  storageSet(getOnboardingDraftKey(userId), JSON.stringify(answers));

export const clearOnboardingDraft = (userId: string) =>
  storageRemove(getOnboardingDraftKey(userId));
