import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

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
  if (!ASSISTANT_ID) {
    console.error("OPENAI_ASSISTANT_ID is not set");
    res.status(500).json({ error: "Server configuration error: missing assistant ID" });
    return;
  }

  try {
    const { action, threadId, message } = req.body;

    // Create a new thread
    if (action === "create_thread") {
      console.log("Creating thread...");
      const thread = await openai.beta.threads.create();
      console.log("Thread created:", thread.id);
      res.status(200).json({ threadId: thread.id });
      return;
    }

    // Send a message and stream the response
    if (!threadId || !message) {
      res.status(400).json({ error: "Missing threadId or message" });
      return;
    }

    console.log("Sending message to thread:", threadId);

    // Add user message to thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: message,
    });

    // Run the assistant with streaming (retry up to 2 times on server_error)
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const MAX_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      console.log(`Starting assistant run (attempt ${attempt + 1}) with ID:`, ASSISTANT_ID);
      const stream = await openai.beta.threads.runs.stream(threadId, {
        assistant_id: ASSISTANT_ID,
      });

      let failed = false;
      let serverError = false;

      for await (const event of stream) {
        if (event.event === "thread.message.delta") {
          const delta = event.data.delta;
          if (delta.content && delta.content[0]?.type === "text") {
            const text = delta.content[0].text?.value || "";
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        }

        if (event.event === "thread.run.completed") {
          console.log("Run completed successfully");
          res.write("data: [DONE]\n\n");
          break;
        }

        if (event.event === "thread.run.failed") {
          const errorMsg = event.data?.last_error?.message || "Unknown error";
          const errorCode = event.data?.last_error?.code || "unknown";
          console.error(`Run failed (attempt ${attempt + 1}):`, errorCode, errorMsg);
          failed = true;
          serverError = errorCode === "server_error";
          if (!serverError || attempt === MAX_RETRIES) {
            res.write(`data: ${JSON.stringify({ error: "Error: " + errorMsg })}\n\n`);
          }
          break;
        }
      }

      if (!failed || !serverError) break;
      if (attempt < MAX_RETRIES) {
        console.log(`Retrying in 1 second...`);
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    res.end();
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
