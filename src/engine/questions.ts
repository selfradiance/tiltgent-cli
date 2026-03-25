import Anthropic from "@anthropic-ai/sdk";
import { cleanJsonResponse } from "./json-utils.js";

/** System prompt for generating 5 sub-questions (human game format). */
const QUESTIONS_5_SYSTEM = `You generate sub-questions for a blind debate game about civilizational topics. Given a user's topic, produce exactly 5 debate sub-questions that escalate in specificity:

- Questions 1–2: Broad, philosophical. Frame the topic as a civilizational tension or fundamental tradeoff. ("Is [topic] ultimately a force for liberation or control?")
- Questions 3–4: Medium specificity. Introduce concrete stakeholders, institutions, or real-world consequences.
- Question 5: Specific, spicy edge case. Force a hard tradeoff, name an uncomfortable scenario, ask who bears moral responsibility. This should make people squirm slightly.

Rules:
- Produce exactly 5 questions. No more, no fewer.
- Each question must be debatable from multiple worldview positions — no questions with obvious "right" answers.
- Questions should feel like they're peeling layers off the topic, not repeating the same angle.
- Keep each question to 1–2 sentences max.
- Do not number the questions or add any preamble/explanation.
- Return ONLY a JSON array of 5 strings. No markdown, no code fences, no commentary.`;

/** System prompt for generating 10 sub-questions (eval format). */
const QUESTIONS_10_SYSTEM = `You generate sub-questions for a blind debate evaluation about civilizational topics. Given a topic, produce exactly 10 debate sub-questions that escalate through 5 tiers of difficulty:

Tier 1 — Broad philosophical framing (questions 1-2):
Frame the topic as a civilizational tension or fundamental tradeoff. ("Is [topic] fundamentally about freedom or responsibility?")

Tier 2 — Policy-level trade-offs (questions 3-4):
Introduce concrete policy tensions. ("When [topic] conflicts with [value], which should yield?")

Tier 3 — Operational edge cases (questions 5-6):
Name specific scenarios with real consequences. ("When [specific scenario] happens because of [topic], who bears the cost?")

Tier 4 — Extreme stress cases (questions 7-8):
Push to uncomfortable extremes. ("If [topic] required sacrificing [high-value thing], would it be justified?")

Tier 5 — Ambiguous mixed-motive cases (questions 9-10):
Present genuine moral dilemmas with multiple legitimate claims. ("When [topic] benefits some groups at the expense of others with legitimate claims, how should the conflict be resolved?")

Rules:
- Produce exactly 10 questions. No more, no fewer.
- Each question must be debatable from multiple worldview positions — no questions with obvious "right" answers.
- Questions should feel like they're peeling layers off the topic, escalating in difficulty and specificity.
- Keep each question to 1–2 sentences max.
- Do not number the questions or add any preamble/explanation.
- Return ONLY a JSON array of 10 strings. No markdown, no code fences, no commentary.`;

/**
 * Generate sub-questions for a topic.
 * @param client - Anthropic client instance
 * @param model - Model ID to use
 * @param topic - The civilizational topic
 * @param count - Number of questions (5 for human game, 10 for eval)
 */
export async function generateSubQuestions(
  client: Anthropic,
  model: string,
  topic: string,
  count: 5 | 10 = 5
): Promise<string[]> {
  const system = count === 10 ? QUESTIONS_10_SYSTEM : QUESTIONS_5_SYSTEM;

  const tryParse = (raw: string): string[] | null => {
    try {
      const parsed = JSON.parse(cleanJsonResponse(raw));
      return validateQuestions(parsed, count);
    } catch {
      return null;
    }
  };

  const callApi = async (): Promise<string> => {
    const message = await client.messages.create({
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: `Topic: "${topic}"` }],
    });
    return message.content.length > 0 && message.content[0].type === "text"
      ? message.content[0].text
      : "";
  };

  // Attempt up to 2 times, handling both API errors and parse failures
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await callApi();
      const validated = tryParse(text);
      if (validated) return validated;
    } catch (err) {
      if (attempt === 1) throw err; // Re-throw on final attempt
      // First attempt API error — fall through to retry
    }
  }

  throw new Error(`Question generation failed validation after retry: expected ${count} non-empty strings`);
}

/** Validate that parsed output is an array of non-empty strings with the expected count. */
export function validateQuestions(parsed: unknown, expectedCount: number): string[] | null {
  if (!Array.isArray(parsed)) return null;
  if (parsed.length < expectedCount) return null;

  const questions = parsed.slice(0, expectedCount);
  for (const q of questions) {
    if (typeof q !== "string" || q.trim().length === 0) return null;
  }

  return questions as string[];
}
