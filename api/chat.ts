import { createChatCompletion, getClientErrorMessage } from "../api";

const getBody = (req: any) => {
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  return req.body || {};
};

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }

  try {
    const { messages } = getBody(req);
    const message = await createChatCompletion(messages);
    res.status(200).json({ message });
  } catch (error) {
    console.error("Vercel API chat error:", error);
    res.status(500).json({ error: getClientErrorMessage(error) });
  }
}
