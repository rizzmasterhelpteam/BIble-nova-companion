import type { SupabaseClient } from "@supabase/supabase-js";

export type OnboardingAnswers = {
  reason?: string;
  frequency?: string;
  goal?: string;
  support?: string;
  rhythm?: string;
};

export type RemoteOnboardingAnswers = OnboardingAnswers & {
  user_id: string;
  completed_at: string;
  updated_at: string;
};

const nullableAnswer = (value: string | undefined) => value || null;

export const buildOnboardingRecord = (
  userId: string,
  answers: OnboardingAnswers = {},
  completedAt = new Date().toISOString(),
) => ({
  user_id: userId,
  reason: nullableAnswer(answers.reason),
  frequency: nullableAnswer(answers.frequency),
  goal: nullableAnswer(answers.goal),
  support: nullableAnswer(answers.support),
  rhythm: nullableAnswer(answers.rhythm),
  completed_at: completedAt,
  updated_at: completedAt,
});

export const loadRemoteOnboardingAnswers = async (
  client: SupabaseClient,
  userId: string,
) => {
  const { data, error } = await client
    .from("onboarding_answers")
    .select("user_id, reason, frequency, goal, support, rhythm, completed_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle<RemoteOnboardingAnswers>();

  if (error) throw new Error(error.message);
  return data;
};

export const persistOnboardingAnswers = async (
  client: SupabaseClient,
  userId: string,
  answers: OnboardingAnswers = {},
) => {
  const { error } = await client
    .from("onboarding_answers")
    .upsert(buildOnboardingRecord(userId, answers), { onConflict: "user_id" });

  if (error) throw new Error(error.message);
};
