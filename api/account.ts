import { enforceRateLimits, getHttpErrorDetails, getSupabaseAdminClient, requireAuthenticatedRequest } from "../server-security.js";
import { setApiCorsHeaders } from "../server-cors.js";
const deleteSupabaseAccount = async (userId: string) => {
  const adminClient = getSupabaseAdminClient();
  const { error: dataError } = await adminClient.rpc("delete_account_data", {
    p_user_id: userId,
  });

  if (dataError) {
    console.error("Account data cleanup failed:", dataError.message);
    throw new Error("Your account data could not be removed. Please try again.");
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);

  if (deleteError) {
    console.error("Auth account deletion failed:", deleteError.message);
    throw new Error("Your account could not be deleted. Please try again.");
  }

  return userId;
};

export default async function handler(req: any, res: any) {
  if (!setApiCorsHeaders(req, res, "DELETE, OPTIONS", "Content-Type, Authorization")) return;

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "DELETE") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { userId } = await requireAuthenticatedRequest(req);
    await enforceRateLimits([
      { key: `account:user:${userId}`, limit: 3 },
    ]);
    await deleteSupabaseAccount(userId);
    res.status(200).json({ deleted: true });
  } catch (error) {
    const details = getHttpErrorDetails(error);
    if (details.retryAfterSeconds) res.setHeader?.("Retry-After", String(details.retryAfterSeconds));
    res.status(details.statusCode).json({
      error: details.statusCode >= 500
        ? "Account deletion is temporarily unavailable. Please try again."
        : details.message,
    });
  }
}
