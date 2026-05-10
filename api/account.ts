import { deleteSupabaseAccount, getClientErrorMessage } from "../server-api";

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
