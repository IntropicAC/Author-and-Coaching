/**
 * Add documents to an existing assistant.
 *
 * Usage:
 *   1. Place your .docx / .pdf / .txt files in the "documents" folder.
 *   2. Make sure your .env has OPENAI_API_KEY and OPENAI_ASSISTANT_ID set.
 *   3. Run:  node scripts/add-documents.js
 */

import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SAM_AI_INSTRUCTIONS } from "./sam-instructions.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env manually
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
if (!process.env.OPENAI_ASSISTANT_ID || process.env.OPENAI_ASSISTANT_ID === "your_assistant_id_here") {
  console.error("Error: Run setup-assistant.js first to create your assistant.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const DOCUMENTS_DIR = path.resolve(__dirname, "..", "documents");

async function main() {
  const files = fs.readdirSync(DOCUMENTS_DIR).filter(f =>
    /\.(docx|doc|pdf|txt|md)$/i.test(f)
  );

  if (files.length === 0) {
    console.log('\nNo documents found in the "documents" folder.');
    console.log("Add your .docx, .pdf, or .txt files and run again.\n");
    process.exit(0);
  }

  console.log(`\nFound ${files.length} document(s):\n`);
  files.forEach(f => console.log(`  - ${f}`));

  // 1. Create vector store
  console.log("\n1. Creating vector store...");
  const vectorStore = await openai.vectorStores.create({
    name: "Sam Murgatroyd - Books & Coaching Materials",
  });
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

  // 4. Update the assistant to use file_search with the new vector store + refresh instructions
  console.log("\n4. Updating assistant with document access and instructions...");
  await openai.beta.assistants.update(process.env.OPENAI_ASSISTANT_ID, {
    instructions: SAM_AI_INSTRUCTIONS,
    tools: [{ type: "file_search" }],
    tool_resources: {
      file_search: {
        vector_store_ids: [vectorStore.id],
      },
    },
  });

  console.log("\n" + "=".repeat(55));
  console.log("  Documents added and instructions updated!");
  console.log("  Your assistant now has file access.");
  console.log("=".repeat(55) + "\n");
}

main().catch(err => {
  console.error("Failed:", err.message);
  process.exit(1);
});
