import OpenAI from "openai";
import { SAM_AI_INSTRUCTIONS } from "../scripts/sam-instructions.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// OPENAI_ASSISTANT_ID is optional now (kept as a fallback to discover a vector store ID).
const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const VECTOR_STORE_ID = process.env.OPENAI_VECTOR_STORE_ID;
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_OUTPUT_TOKENS = parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS || "450", 10);
const MAX_RESPONSE_WORDS = parseInt(process.env.SAM_MAX_RESPONSE_WORDS || "300", 10);

// ============ SECURITY CONFIGURATION ============
const ALLOWED_ORIGINS = [
  "https://www.sam-murgatroyd.co.uk",
  "https://sam-murgatroyd.co.uk",
];
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 15;  // 15 requests per minute
const MAX_THREADS_PER_DAY = 10;      // 10 new threads per day
const MAX_MESSAGE_LENGTH = 500;

// ============ RATE LIMITING (In-Memory) ============
const rateLimitMap = new Map();

// ============ SEQUENTIAL TOKEN SYSTEM ============
// Prevents parallel request abuse - each request must include token from previous response
const tokenMap = new Map(); // threadId -> { token, timestamp }
const TOKEN_EXPIRY = 5 * 60 * 1000; // 5 minutes

function generateToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function validateSequentialToken(threadId, token) {
  // First request for a thread doesn't need a token
  if (!tokenMap.has(threadId)) {
    return { valid: true, isFirst: true };
  }

  const stored = tokenMap.get(threadId);

  // Check if token expired
  if (Date.now() - stored.timestamp > TOKEN_EXPIRY) {
    tokenMap.delete(threadId);
    return { valid: false, reason: "expired" };
  }

  // Check if token matches
  if (stored.token !== token) {
    return { valid: false, reason: "invalid" };
  }

  return { valid: true };
}

function extractRequestedWordCount(message) {
  if (!message || typeof message !== "string") return null;
  const match = message.match(/(\d{1,3}(?:,\d{3})?)\s*(?:word|words)\b/i);
  if (!match) return null;
  const value = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(value) ? value : null;
}

function setNextToken(threadId) {
  const token = generateToken();
  tokenMap.set(threadId, { token, timestamp: Date.now() });

  // Cleanup old tokens periodically
  if (tokenMap.size > 5000) {
    const now = Date.now();
    for (const [id, data] of tokenMap) {
      if (now - data.timestamp > TOKEN_EXPIRY) tokenMap.delete(id);
    }
  }

  return token;
}

function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers["x-real-ip"] || "unknown";
}

function checkRateLimit(ip, isThreadCreation = false) {
  const now = Date.now();
  const dayStart = new Date().setHours(0, 0, 0, 0);

  // Cleanup old entries to prevent memory bloat
  if (rateLimitMap.size > 10000) {
    for (const [key, val] of rateLimitMap) {
      if (now - val.timestamp > RATE_LIMIT_WINDOW * 10) rateLimitMap.delete(key);
    }
  }

  if (!rateLimitMap.has(ip)) {
    rateLimitMap.set(ip, {
      count: 1,
      timestamp: now,
      dailyThreads: isThreadCreation ? 1 : 0,
      dayStart,
    });
    return { allowed: true };
  }

  const data = rateLimitMap.get(ip);

  // Reset daily counter if new day
  if (data.dayStart !== dayStart) {
    data.dailyThreads = 0;
    data.dayStart = dayStart;
  }

  // Check daily thread limit
  if (isThreadCreation && data.dailyThreads >= MAX_THREADS_PER_DAY) {
    return { allowed: false, reason: "daily_limit" };
  }

  // Reset window if expired
  if (now - data.timestamp > RATE_LIMIT_WINDOW) {
    data.count = 1;
    data.timestamp = now;
    if (isThreadCreation) data.dailyThreads++;
    return { allowed: true };
  }

  // Check rate limit
  if (data.count >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - data.timestamp)) / 1000);
    return { allowed: false, reason: "rate_limit", retryAfter };
  }

  // Increment counters
  data.count++;
  if (isThreadCreation) data.dailyThreads++;
  return { allowed: true };
}

// ============ INPUT VALIDATION ============
function validateInput(body) {
  const { message, threadId } = body;

  if (message !== undefined) {
    if (typeof message !== "string" || message.trim().length === 0) {
      return { valid: false, error: "Message cannot be empty" };
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      return { valid: false, error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)` };
    }
  }

  if (threadId && (typeof threadId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(threadId))) {
    return { valid: false, error: "Invalid conversation ID" };
  }

  return { valid: true };
}

// ============ ORIGIN VALIDATION ============
function validateOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Allow server-side requests (no origin header)
  return ALLOWED_ORIGINS.includes(origin);
}

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

  // ============ SECURITY CHECKS ============

  // 1. Origin validation
  if (!validateOrigin(req)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // 2. Honeypot check (bots auto-fill hidden fields)
  const { honeypot } = req.body || {};
  if (honeypot && honeypot.trim() !== "") {
    // Silently accept but don't process (don't reveal detection)
    return res.status(200).json({ threadId: "ok" });
  }

  // 3. Rate limiting
  const clientIP = getClientIP(req);
  const { action } = req.body || {};
  const rateCheck = checkRateLimit(clientIP, action === "create_thread");
  if (!rateCheck.allowed) {
    if (rateCheck.retryAfter) {
      res.setHeader("Retry-After", rateCheck.retryAfter);
    }
    const errorMsg = rateCheck.reason === "daily_limit"
      ? "You've started too many chats today. Please try again tomorrow."
      : "Please slow down. Try again in a moment.";
    return res.status(429).json({ error: errorMsg });
  }

  // 4. Input validation
  const inputCheck = validateInput(req.body || {});
  if (!inputCheck.valid) {
    return res.status(400).json({ error: inputCheck.error });
  }

  // 5. Sequential token validation (prevents parallel request abuse)
  const { threadId, seqToken } = req.body || {};
  if (action !== "create_thread" && threadId) {
    const tokenCheck = validateSequentialToken(threadId, seqToken);
    if (!tokenCheck.valid) {
      const existing = tokenMap.get(threadId);
      const recoveryToken = existing?.token || setNextToken(threadId);
      return res.status(429).json({
        error: tokenCheck.reason === "expired"
          ? "Session expired. Please refresh the page."
          : "Please wait for the previous message to complete.",
        seqToken: recoveryToken,
      });
    }
  }

  // ============ END SECURITY CHECKS ============

  // Check env vars are set
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set");
    res.status(500).json({ error: "Server configuration error: missing API key" });
    return;
  }

  try {
    const { threadId, message } = req.body;

    // Create a new thread
    if (action === "create_thread") {
      console.log("Creating conversation...");
      const conversation = await openai.post("/conversations", { body: {} });
      console.log("Conversation created:", conversation.id);
      // Generate first sequential token for this thread
      const nextToken = setNextToken(conversation.id);
      res.status(200).json({ threadId: conversation.id, seqToken: nextToken });
      return;
    }

    // Send a message and stream the response
    if (!threadId || !message) {
      res.status(400).json({ error: "Missing threadId or message" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const requestedWordCount = extractRequestedWordCount(message);
    if (requestedWordCount && requestedWordCount > MAX_RESPONSE_WORDS) {
      const reply =
        `I keep replies under ${MAX_RESPONSE_WORDS} words so they stay complete and readable. ` +
        "I can give you a shorter summary, or split it into parts and continue if you want. " +
        "Which would you prefer?";
      const nextToken = setNextToken(threadId);
      res.write(`data: ${JSON.stringify({ text: reply })}\n\n`);
      res.write(`data: ${JSON.stringify({ seqToken: nextToken })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    console.log("Sending message to conversation:", threadId);

    // Stream the response (retry up to 2 times on server errors)
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
          max_output_tokens: MAX_OUTPUT_TOKENS,
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
            // Send next sequential token before ending
            const nextToken = setNextToken(threadId);
            res.write(`data: ${JSON.stringify({ seqToken: nextToken })}\n\n`);
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
            // Still send next token so user can retry
            const nextToken = setNextToken(threadId);
            res.write(`data: ${JSON.stringify({ error: "Error: " + errorMsg, seqToken: nextToken })}\n\n`);
            res.end();
            return;
          }
        }

        // If the stream ends without an explicit completion event, end gracefully.
        const nextToken = setNextToken(threadId);
        res.write(`data: ${JSON.stringify({ seqToken: nextToken })}\n\n`);
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
          // Still send next token so user can retry
          const nextToken = setNextToken(threadId);
          res.write(`data: ${JSON.stringify({ error: "Error: " + errorMsg, seqToken: nextToken })}\n\n`);
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
