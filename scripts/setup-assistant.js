/**
 * One-time setup script to create an OpenAI Assistant with file_search.
 *
 * Usage:
 *   1. Place your .docx / .pdf / .txt files in a "documents" folder next to this script's parent.
 *   2. Make sure your .env has OPENAI_API_KEY set.
 *   3. Run:  node scripts/setup-assistant.js
 *
 * The script will output an OPENAI_ASSISTANT_ID to add to your .env file.
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env manually (no extra dependency)
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^\s*([\w]+)\s*=\s*(.+?)\s*$/);
    if (match) process.env[match[1]] = match[2];
  }
}

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === "your_api_key_here") {
  console.error("Error: Set your OPENAI_API_KEY in the .env file first.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const DOCUMENTS_DIR = path.resolve(__dirname, "..", "documents");

async function main() {
  // Check for documents (optional - can run without them)
  let vectorStoreId = null;

  if (!fs.existsSync(DOCUMENTS_DIR)) {
    fs.mkdirSync(DOCUMENTS_DIR);
  }

  const files = fs.readdirSync(DOCUMENTS_DIR).filter(f =>
    /\.(docx|doc|pdf|txt|md)$/i.test(f)
  );

  if (files.length === 0) {
    console.log("\nNo documents found — creating assistant WITHOUT file search.");
    console.log("You can add documents later by running: node scripts/add-documents.js\n");
  } else {
    console.log(`\nFound ${files.length} document(s):\n`);
    files.forEach(f => console.log(`  - ${f}`));

    // 1. Create vector store
    console.log("\n1. Creating vector store...");
    const vectorStore = await openai.beta.vectorStores.create({
      name: "Sam Murgatroyd - Books & Coaching Materials",
    });
    vectorStoreId = vectorStore.id;
    console.log(`   Vector Store ID: ${vectorStore.id}`);

    // 2. Upload files
    console.log("\n2. Uploading documents...");
    const fileIds = [];
    for (const filename of files) {
      const filePath = path.join(DOCUMENTS_DIR, filename);
      console.log(`   Uploading: ${filename}`);
      const file = await openai.files.create({
        file: fs.createReadStream(filePath),
        purpose: "assistants",
      });
      fileIds.push(file.id);
      console.log(`   Done: ${file.id}`);
    }

    // 3. Add files to vector store
    console.log("\n3. Adding files to vector store...");
    const batch = await openai.beta.vectorStores.fileBatches.createAndPoll(
      vectorStore.id,
      { file_ids: fileIds }
    );
    console.log(`   Status: ${batch.status}`);
    console.log(`   Files processed: ${batch.file_counts.completed}/${batch.file_counts.total}`);
  }

  // 4. Create assistant
  const stepNum = files.length > 0 ? "4" : "1";
  console.log(`\n${stepNum}. Creating assistant...`);
  const assistant = await openai.beta.assistants.create({
    name: "Sam AI",
    instructions: `You are "Sam AI", the friendly AI assistant on Sam Murgatroyd's author and coaching website. Sam is an author and authenticity & belief coach from Manchester, England.

YOUR PURPOSE:
You help website visitors learn about Sam's books and coaching, then encourage them to take action — either purchasing a book or reaching out for coaching.

BOOKS (always include the correct Amazon link when recommending):
- "The Policy" — A 30-page story asking why we lie. A man's life of deception unravels on a storm-soaked train ride. Amazon: https://www.amazon.co.uk/Policy-Sam-Murgatroyd-ebook/dp/B0FLZZ96WL/
- "Alienated" — A book about embracing feeling different, packed with metaphors and personal insights on connection and meaning. Amazon: https://www.amazon.co.uk/Alienated-Sam-Murgatroyd/dp/B0CVF4BCDR/
- "Robin's Bench" — A novel following Adam, who meets Robin in the Peak District and rediscovers himself through honest, philosophical conversations. Amazon: https://www.amazon.co.uk/Robins-Bench-Sam-Murgatroyd/dp/B0FFGY7JP5/

COACHING:
Sam helps people dissolve self-doubt, befriend their inner voice, and choose bold action. His background includes working in psychiatric hospitals, probation hostels, children's care homes, and SEN schools — giving him a unique perspective on what people go through.

HOW TO BEHAVE:
- Be warm, encouraging, and thoughtful — match Sam's coaching style.
- Use the file_search tool to find relevant passages, quotes, or concepts from Sam's actual books and materials.
- Share brief, compelling excerpts or insights to hook interest — but NEVER summarise entire chapters or give away major plot points.
- Always guide the conversation toward a clear next step: "You can grab the book here" or "If this resonates, Sam offers 1-to-1 coaching — use the contact form on this page."
- If someone asks about coaching, encourage them to fill in the contact form on the website.
- Keep responses concise (under 250 words).
- Be honest if you don't know something specific.
- Stay on-topic: Sam's books, coaching, personal development, authenticity, and self-belief.`,
    model: "gpt-4o-mini",
    tools: vectorStoreId ? [{ type: "file_search" }] : [],
    ...(vectorStoreId && {
      tool_resources: {
        file_search: {
          vector_store_ids: [vectorStoreId],
        },
      },
    }),
  });

  console.log(`   Assistant ID: ${assistant.id}`);

  // 5. Summary
  console.log("\n" + "=".repeat(55));
  console.log("  Setup complete! Add this to your .env file:");
  console.log("=".repeat(55));
  console.log(`OPENAI_ASSISTANT_ID=${assistant.id}`);
  console.log("=".repeat(55));
  console.log("\nAlso add this as an environment variable in Vercel:");
  console.log("  Vercel Dashboard → Settings → Environment Variables\n");
}

main().catch(err => {
  console.error("Setup failed:", err.message);
  process.exit(1);
});
