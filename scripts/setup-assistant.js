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
import { SAM_AI_INSTRUCTIONS } from "./sam-instructions.js";

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
    const vectorStore = await openai.vectorStores.create({
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
    const batch = await openai.vectorStores.fileBatches.createAndPoll(
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
    instructions: SAM_AI_INSTRUCTIONS,
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
