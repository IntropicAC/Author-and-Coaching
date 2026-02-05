import OpenAI from "openai";
import { SAM_AI_INSTRUCTIONS } from "../scripts/sam-instructions.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// OPENAI_ASSISTANT_ID is optional now (kept as a fallback to discover a vector store ID).
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  // Check env vars are set
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set");
    res.status(500).json({ error: "Server configuration error: missing API key" });
    return;
  }

  try {
    const { action, threadId, message } = req.body;

    // Create a new thread
    if (action === "create_thread") {
      console.log("Creating conversation...");
      const conversation = await openai.post("/conversations", { body: {} });
      console.log("Conversation created:", conversation.id);
      res.status(200).json({ threadId: conversation.id });
      return;
    }

    // Send a message and stream the response
    if (!threadId || !message) {
      res.status(400).json({ error: "Missing threadId or message" });
      return;
    }

    console.log("Sending message to conversation:", threadId);

    // Stream the response (retry up to 2 times on server errors)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let vectorStoreId = VECTOR_STORE_ID || null;
    if (!vectorStoreId && ASSISTANT_ID) {
      try {
        const assistant = await openai.beta.assistants.retrieve(ASSISTANT_ID);
        vectorStoreId = assistant?.tool_resources?.file_search?.vector_store_ids?.[0] || null;
        if (vectorStoreId) {
          console.log("Using vector store discovered from assistant:", vectorStoreId);
        }
      } catch (err) {
        console.warn("Could not retrieve assistant to discover vector store ID:", err?.message || err);
      }
    }

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Starting response stream (attempt ${attempt + 1}) model=${MODEL}`);

        const request = {
          model: MODEL,
          instructions: SAM_AI_INSTRUCTIONS,
          conversation: threadId,
          input: message,
          stream: true,
          ...(vectorStoreId
            ? { tools: [{ type: "file_search", vector_store_ids: [vectorStoreId] }] }
            : {}),
        };

        const stream = await openai.responses.create(request);

        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            const text = event.delta || "";
            if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }

          if (event.type === "response.completed") {
            console.log("Response completed successfully");
            res.write("data: [DONE]\n\n");
            res.end();
            return;
          }

          if (event.type === "response.failed" || event.type === "response.error") {
            const errorMsg =
              event.error?.message ||
              event.error?.type ||
              "Unknown error";
            console.error(`Response stream failed (attempt ${attempt + 1}):`, errorMsg);
            res.write(`data: ${JSON.stringify({ error: "Error: " + errorMsg })}\n\n`);
            res.end();
            return;
          }
        }

        // If the stream ends without an explicit completion event, end gracefully.
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      } catch (err) {
        const status = err?.status || err?.response?.status;
        const code = err?.code || err?.error?.code;
        const errorMsg = err?.message || err?.error?.message || "Unknown error";
        const isServerError = (typeof status === "number" && status >= 500) || code === "server_error";

        console.error(`Responses API error (attempt ${attempt + 1}):`, status || code || "unknown", errorMsg);

        if (!isServerError || attempt === MAX_RETRIES) {
          res.write(`data: ${JSON.stringify({ error: "Error: " + errorMsg })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
          return;
        }

        console.log("Retrying in 1 second...");
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Fallback safety (should not reach here due to returns above).
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    console.error("Chat API error:", err.message);
    console.error("Full error:", JSON.stringify(err, null, 2));
    if (!res.headersSent) {
      res.status(500).json({ error: "API Error: " + err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Error: " + err.message })}\n\n`);
      res.end();
    }
  }
}
