import { createClient } from "@supabase/supabase-js";

const getClientErrorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("fetch failed")) {
    return "Network error: Could not reach the LLM API.";
  }

  if (message.includes("API key") || message.toLowerCase().includes("unauthorized")) {
    return "Your API key is invalid or unauthorized. Please verify it in Settings/Secrets.";
  }

  return message || "Failed to generate response. Please try again.";
};

const deleteSupabaseAccount = async (authorizationHeader?: string) => {
  const accessToken = authorizationHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    throw new Error("Missing active session. Please sign in again before deleting the account.");
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("placeholder.supabase.co")) {
    throw new Error("Supabase is not configured on the server.");
  }

  if (!serviceRoleKey) {
    throw new Error("Account deletion requires SUPABASE_SERVICE_ROLE_KEY on the server.");
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await authClient.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("Could not verify the signed-in user. Please sign in again.");
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(data.user.id);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return data.user.id;
};

export default async function handler(req: any, res: any) {
  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    await deleteSupabaseAccount(req.headers.authorization);
    res.status(200).json({ deleted: true });
  } catch (error) {
    console.error("Vercel API account deletion error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
