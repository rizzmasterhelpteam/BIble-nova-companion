import { createChatCompletion, getClientErrorMessage } from "../server-api";

export async function POST(request: Request) {
  try {
    const { messages } = await request.json();
    const message = await createChatCompletion(messages);
    return Response.json({ message });
  } catch (error) {
    console.error("Vercel API chat error:", error);
    return Response.json({ error: getClientErrorMessage(error) }, { status: 500 });
  }
}
