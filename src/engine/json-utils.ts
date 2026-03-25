/**
 * Shared JSON cleaning utility for LLM responses.
 * LLMs sometimes wrap JSON in markdown code fences or add preamble text.
 */

/**
 * Clean an LLM response string before JSON.parse().
 * - Strips markdown code fences (```json ... ``` and ``` ... ```)
 * - Strips leading/trailing whitespace
 * - If direct parse fails, extracts the substring between the first
 *   `{` or `[` and the last `}` or `]`
 */
export function cleanJsonResponse(raw: string): string {
  // Strip markdown code fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  // If it looks like valid JSON already, return as-is
  if (
    (cleaned.startsWith("{") && cleaned.endsWith("}")) ||
    (cleaned.startsWith("[") && cleaned.endsWith("]"))
  ) {
    return cleaned;
  }

  // Extract JSON substring between first opening and last closing bracket
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");

  // Determine which type of JSON structure to extract
  // Prefer objects over arrays since most LLM prompts request objects
  let start = -1;
  let end = -1;

  if (firstBrace !== -1 && lastBrace > firstBrace) {
    start = firstBrace;
    end = lastBrace;
  } else if (firstBracket !== -1 && lastBracket > firstBracket) {
    start = firstBracket;
    end = lastBracket;
  }

  if (start !== -1 && end > start) {
    return cleaned.slice(start, end + 1);
  }

  // Nothing found — return as-is and let JSON.parse fail
  return cleaned;
}
