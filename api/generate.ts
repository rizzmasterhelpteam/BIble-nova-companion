import { generatePrayer, getClientErrorMessage } from "../server-api";

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json();
    const text = await generatePrayer(prompt);
    return Response.json({ text });
  } catch (error) {
    console.error("Vercel API generation error:", error);
    return Response.json({ error: getClientErrorMessage(error) }, { status: 500 });
  }
}
