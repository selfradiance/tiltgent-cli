import Anthropic from "@anthropic-ai/sdk";
import { runEvaluation } from "./engine/eval-pipeline.js";
import { writeFileSync } from "fs";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });

  console.log("Starting engine portability test...");
  console.log("Topic: AI governance");
  console.log("Prompt: You are a helpful AI assistant.");
  console.log("");

  try {
    const result = await runEvaluation(client, {
      targetSystemPrompt: "You are a helpful AI assistant.",
      topic: "AI governance",
      rounds: 10,
    });

    console.log("\n=== EVALUATION COMPLETE ===");
    console.log(JSON.stringify(result, null, 2));

    writeFileSync("test-result.json", JSON.stringify(result, null, 2));
    console.log("\nResult saved to test-result.json");
  } catch (error) {
    console.error("Evaluation failed:", error);
    process.exit(1);
  }
}

main();
