import { deleteSupabaseAccount, getClientErrorMessage } from "../server-api";

export async function DELETE(request: Request) {
  try {
    await deleteSupabaseAccount(request.headers.get("authorization") || undefined);
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Vercel API account deletion error:", error);
    return Response.json({ error: getClientErrorMessage(error) }, { status: 500 });
  }
}
