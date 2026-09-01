import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  buildOnboardingRecord,
  persistOnboardingAnswers,
} from "../src/lib/onboardingPersistence";

describe("durable onboarding persistence", () => {
  it("builds a completed, account-scoped record from the onboarding answers", () => {
    expect(
      buildOnboardingRecord(
        "user-a",
        { reason: "stress", goal: "peace", support: "gentle" },
        "2026-08-04T12:00:00.000Z",
      ),
    ).toEqual({
      user_id: "user-a",
      reason: "stress",
      frequency: null,
      goal: "peace",
      support: "gentle",
      rhythm: null,
      completed_at: "2026-08-04T12:00:00.000Z",
      updated_at: "2026-08-04T12:00:00.000Z",
    });
  });

  it("upserts answers on the user's durable onboarding row", async () => {
    const calls: Array<{ table: string; values: unknown; options: unknown }> = [];
    const client = {
      from: (table: string) => ({
        upsert: (values: unknown, options: unknown) => {
          calls.push({ table, values, options });
          return Promise.resolve({ error: null });
        },
      }),
    } as unknown as SupabaseClient;

    await persistOnboardingAnswers(client, "user-a", { reason: "faith" });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("onboarding_answers");
    expect(calls[0]?.options).toEqual({ onConflict: "user_id" });
    expect(calls[0]?.values).toMatchObject({
      user_id: "user-a",
      reason: "faith",
      completed_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("does not report completion when the durable write fails", async () => {
    const client = {
      from: () => ({
        upsert: () => Promise.resolve({ error: { message: "permission denied" } }),
      }),
    } as unknown as SupabaseClient;

    await expect(persistOnboardingAnswers(client, "user-a")).rejects.toThrow("permission denied");
  });
});
