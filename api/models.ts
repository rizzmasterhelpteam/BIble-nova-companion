export async function GET() {
  try {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey?.trim()) {
      return Response.json({ error: "GROK_API_KEY is missing." }, { status: 500 });
    }

    const response = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 500 });
  }
}
