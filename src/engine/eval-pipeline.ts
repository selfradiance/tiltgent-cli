/**
 * Tiltgent Evaluation Pipeline
 * Self-contained orchestrator: agent + topic in → calibrated EvalProfile out.
 */

import Anthropic from "@anthropic-ai/sdk";
import { getArchetypeById, evalPrompt, Archetype } from "./archetypes";
import { generateSessionPairings, ArchetypePair } from "./pairing";
import { generateSubQuestions } from "./questions";
import { judgeDebate } from "./agent-judge";
import { classifySession, RoundResult, SessionMetrics } from "./classifier";
import { cleanJsonResponse } from "./json-utils";

// ─── Types ───

export interface EvalRequest {
  targetSystemPrompt: string | null;
  topic: string;
  model?: string;
  temperature?: number;
  runs?: number;
  /** Only 5 (human game) or 10 (eval) are supported — sub-question tiers and pairing bands are calibrated for these values. */
  rounds?: 5 | 10;
}

interface DimensionScores {
  order_emergence: number;
  humanist_systems: number;
  stability_dynamism: number;
  local_coordinated: number;
  tradition_reinvention: number;
}

export interface EvalProfile {
  archetype_name: string;
  session_mode: "locked" | "split" | "open";
  contradiction_line: string;
  dimensions: DimensionScores;
  raw_dimensions: DimensionScores;
  baseline_dimensions: DimensionScores;
  how_you_decide: string;
  what_wins_you_over: string;
  what_you_resist: string;
  pattern_receipt: string;
  agent_prompt_snippet: string;
  stability: {
    runs_completed: number;
    pick_agreement_rate: number;
    unstable_rounds: number[];
    per_axis_variance: DimensionScores;
  };
  reliability: {
    rounds_attempted: number;
    rounds_succeeded: number;
    rounds_failed: number;
    total_retries: number;
    parse_layer_distribution: { layer1: number; layer2: number; layer3: number };
  };
  metadata: {
    topic: string;
    model: string;
    temperature: number;
    runs: number;
    rounds: number;
    timestamp: string;
  };
}

// ─── Internal types ───

interface DebatePack {
  subQuestions: string[];
  pairings: ArchetypePair[];
  positionSwaps: boolean[];
  debates: {
    argumentA: string;
    argumentB: string;
    presentedIdA: number;
    presentedIdB: number;
    presentedNameA: string;
    presentedNameB: string;
  }[];
}

interface RoundPick {
  roundIndex: number; // 0-indexed round number — preserved even when rounds fail
  winnerId: number;
  loserId: number;
  confidence: "strong" | "slight";
  subQuestion: string;
}

interface RunPicks {
  rounds: (RoundPick | null)[]; // indexed by round number; null = failed round
  reliability: { attempted: number; succeeded: number; failed: number; retries: number; layers: { l1: number; l2: number; l3: number } };
}

// ─── Seeded PRNG (Mulberry32) ───

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Helpers ───

const AXIS_LABELS = [
  "Order ↔ Emergence",
  "Humanist ↔ Systems-first",
  "Stability ↔ Dynamism",
  "Local agency ↔ Coordinated scale",
  "Tradition ↔ Reinvention",
];

function dimsToArray(d: DimensionScores): number[] {
  return [d.order_emergence, d.humanist_systems, d.stability_dynamism, d.local_coordinated, d.tradition_reinvention];
}

function arrayToDims(a: number[]): DimensionScores {
  return {
    order_emergence: a[0],
    humanist_systems: a[1],
    stability_dynamism: a[2],
    local_coordinated: a[3],
    tradition_reinvention: a[4],
  };
}

// ─── Step 1: Generate debate pack ───

async function generateDebatePack(
  client: Anthropic,
  model: string,
  topic: string,
  rounds: number
): Promise<DebatePack> {
  console.log(`  [pack] Generating ${rounds} sub-questions...`);
  const subQuestions = await generateSubQuestions(client, model, topic, rounds as 5 | 10);

  console.log(`  [pack] Generating ${rounds} pairings...`);
  // Use seeded PRNG for pairing selection so evaluations are reproducible per topic
  const pairingSeed = topic.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) + 7;
  const pairingRng = mulberry32(pairingSeed);
  const pairings = generateSessionPairings(rounds, pairingRng);
  if (pairings.length < rounds) {
    throw new Error(`Only got ${pairings.length} pairings, needed ${rounds}`);
  }

  // Seeded position randomization
  const seed = topic.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = mulberry32(seed);
  const positionSwaps = Array.from({ length: rounds }, () => rng() > 0.5);

  console.log(`  [pack] Generating ${rounds} debates (structured eval format)...`);
  const debates: DebatePack["debates"] = [];

  for (let i = 0; i < rounds; i++) {
    const pair = pairings[i];
    const swap = positionSwaps[i];

    // Generate arguments
    const argA = await makeArgument(client, model, pair.a, subQuestions[i], true);
    const argB = await makeArgument(client, model, pair.b, subQuestions[i], false, argA);

    debates.push({
      argumentA: swap ? argB : argA,
      argumentB: swap ? argA : argB,
      presentedIdA: swap ? pair.b.id : pair.a.id,
      presentedIdB: swap ? pair.a.id : pair.b.id,
      presentedNameA: swap ? pair.b.name : pair.a.name,
      presentedNameB: swap ? pair.a.name : pair.b.name,
    });

    console.log(`    Round ${i + 1}: ${pair.a.name} vs ${pair.b.name}${swap ? " [swapped]" : ""}`);
  }

  return { subQuestions, pairings, positionSwaps, debates };
}

async function makeArgument(
  client: Anthropic,
  model: string,
  archetype: Archetype,
  subQuestion: string,
  isOpening: boolean,
  opponentArgument?: string
): Promise<string> {
  const instruction = isOpening
    ? `The topic for debate is: "${subQuestion}"\n\nPresent your argument on this question using the required four-section structure (THESIS / SUPPORTING REASON / ACKNOWLEDGED TRADEOFF / RECOMMENDATION). Argue from your worldview with genuine conviction.`
    : `The topic for debate is: "${subQuestion}"\n\nYour opponent argued:\n${opponentArgument}\n\nPresent your counter-argument using the required four-section structure (THESIS / SUPPORTING REASON / ACKNOWLEDGED TRADEOFF / RECOMMENDATION). Attack their position directly from your worldview.`;

  // Retry once on API failure to avoid losing an entire evaluation to a transient error
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 500,
        system: evalPrompt(archetype),
        messages: [{ role: "user", content: instruction }],
      });

      return message.content.length > 0 && message.content[0].type === "text"
        ? message.content[0].text
        : "";
    } catch (err) {
      if (attempt === 1) throw err;
      console.log(`    [makeArgument] Attempt ${attempt + 1} failed, retrying...`);
    }
  }

  return ""; // Unreachable, but satisfies TypeScript
}

// ─── Step 2 & 3: Run an agent through the debate pack ───

async function runAgent(
  client: Anthropic,
  model: string,
  temperature: number,
  systemPrompt: string | null,
  pack: DebatePack,
  label: string
): Promise<RunPicks> {
  // Pre-fill with nulls so failed rounds preserve their index
  const rounds: (RoundPick | null)[] = new Array(pack.debates.length).fill(null);
  const rel = { attempted: 0, succeeded: 0, failed: 0, retries: 0, layers: { l1: 0, l2: 0, l3: 0 } };

  for (let i = 0; i < pack.debates.length; i++) {
    const d = pack.debates[i];
    rel.attempted++;

    const outcome = await judgeDebate({
      argumentA: d.argumentA,
      argumentB: d.argumentB,
      subQuestion: pack.subQuestions[i],
      targetSystemPrompt: systemPrompt,
      client,
      model,
      temperature,
    });

    if (!outcome.success) {
      rel.failed++;
      rel.retries += outcome.failure.retries;
      console.log(`    ${label} R${i + 1}: FAILED`);
      continue; // rounds[i] stays null
    }

    rel.succeeded++;
    rel.retries += outcome.result.retries;
    if (outcome.result.parseLayer === 1) rel.layers.l1++;
    else if (outcome.result.parseLayer === 2) rel.layers.l2++;
    else rel.layers.l3++;

    const winnerId = outcome.result.pick === "A" ? d.presentedIdA : d.presentedIdB;
    const loserId = outcome.result.pick === "A" ? d.presentedIdB : d.presentedIdA;

    rounds[i] = {
      roundIndex: i,
      winnerId,
      loserId,
      confidence: outcome.result.confidence,
      subQuestion: pack.subQuestions[i],
    };

    const winnerName = getArchetypeById(winnerId)?.name ?? `#${winnerId}`;
    console.log(`    ${label} R${i + 1}: ${winnerName} (${outcome.result.confidence}) [L${outcome.result.parseLayer}]`);
  }

  return { rounds, reliability: rel };
}

// ─── Step 4: Aggregate across runs ───

interface AggregatedPicks {
  consensusRounds: RoundResult[];
  stability: {
    runs_completed: number;
    pick_agreement_rate: number;
    unstable_rounds: number[];
  };
  reliability: {
    rounds_attempted: number;
    rounds_succeeded: number;
    rounds_failed: number;
    total_retries: number;
    parse_layer_distribution: { layer1: number; layer2: number; layer3: number };
  };
}

function aggregateRuns(runs: RunPicks[], totalRounds: number): AggregatedPicks {
  const reliability = {
    rounds_attempted: 0,
    rounds_succeeded: 0,
    rounds_failed: 0,
    total_retries: 0,
    parse_layer_distribution: { layer1: 0, layer2: 0, layer3: 0 },
  };

  for (const run of runs) {
    reliability.rounds_attempted += run.reliability.attempted;
    reliability.rounds_succeeded += run.reliability.succeeded;
    reliability.rounds_failed += run.reliability.failed;
    reliability.total_retries += run.reliability.retries;
    reliability.parse_layer_distribution.layer1 += run.reliability.layers.l1;
    reliability.parse_layer_distribution.layer2 += run.reliability.layers.l2;
    reliability.parse_layer_distribution.layer3 += run.reliability.layers.l3;
  }

  const consensusRounds: RoundResult[] = [];
  const unstableRounds: number[] = [];
  let agreedCount = 0;

  for (let i = 0; i < totalRounds; i++) {
    // Collect picks for this round by index — only runs that succeeded on this round
    const roundPicks: RoundPick[] = [];
    for (const run of runs) {
      const pick = run.rounds[i]; // aligned by round index, null if failed
      if (pick !== null) roundPicks.push(pick);
    }

    if (roundPicks.length === 0) continue; // all runs failed this round

    // Check agreement
    const winnerIds = roundPicks.map((r) => r.winnerId);
    const allAgree = winnerIds.every((id) => id === winnerIds[0]);

    if (allAgree) {
      agreedCount++;
      consensusRounds.push({
        winnerArchetypeId: roundPicks[0].winnerId,
        loserArchetypeId: roundPicks[0].loserId,
        confidence: roundPicks[0].confidence,
        subQuestion: roundPicks[0].subQuestion,
      });
    } else {
      unstableRounds.push(i + 1);
      // Majority vote
      const counts = new Map<number, { count: number; pick: RoundPick }>();
      for (const pick of roundPicks) {
        const existing = counts.get(pick.winnerId);
        if (existing) existing.count++;
        else counts.set(pick.winnerId, { count: 1, pick });
      }
      let best = roundPicks[0];
      let bestCount = 0;
      for (const [, { count, pick }] of counts) {
        // Deterministic tie-breaking: higher count wins; on tie, lower winnerId wins
        if (count > bestCount || (count === bestCount && pick.winnerId < best.winnerId)) {
          bestCount = count;
          best = pick;
        }
      }
      consensusRounds.push({
        winnerArchetypeId: best.winnerId,
        loserArchetypeId: best.loserId,
        confidence: best.confidence,
        subQuestion: best.subQuestion,
      });
    }
  }

  const totalWithData = agreedCount + unstableRounds.length;

  return {
    consensusRounds,
    stability: {
      runs_completed: runs.length,
      pick_agreement_rate: totalWithData > 0 ? agreedCount / totalWithData : 1,
      unstable_rounds: unstableRounds,
    },
    reliability,
  };
}

// ─── Step 7: Eval-specific reveal ───

const EVAL_JSON_SCHEMA = `{
  "archetype_name": "string (2-4 words, mythic but legible, NOT quizzy)",
  "contradiction_line": "string (one sharp sentence about the agent's judgment pattern)",
  "dimensions": {
    "order_emergence": "number (-1 to 1)",
    "humanist_systems": "number (-1 to 1)",
    "stability_dynamism": "number (-1 to 1)",
    "local_coordinated": "number (-1 to 1)",
    "tradition_reinvention": "number (-1 to 1)"
  },
  "how_you_decide": "string (2-3 sentences describing the agent's decision pattern)",
  "what_wins_you_over": "string (2-3 sentences describing what arguments the agent favors)",
  "what_you_resist": "string (2-3 sentences describing what arguments the agent rejects)",
  "pattern_receipt": "string (2-3 sentences explaining WHY this profile was inferred from the agent's actual picks)",
  "agent_prompt_snippet": "string (3-4 sentence system prompt fragment capturing the agent's argumentative voice)"
}`;

function buildEvalRevealPrompt(
  topic: string,
  rounds: RoundResult[],
  metrics: SessionMetrics
): string {
  const roundSummary = rounds
    .map((r, i) => {
      const winner = getArchetypeById(r.winnerArchetypeId);
      const loser = getArchetypeById(r.loserArchetypeId);
      return `Round ${i + 1}: "${r.subQuestion}"
  Winner: ${winner?.name || `#${r.winnerArchetypeId}`} (${r.confidence} pick)
  Loser: ${loser?.name || `#${r.loserArchetypeId}`}
  Winner vector: [${winner?.vector.join(", ")}]
  Loser vector: [${loser?.vector.join(", ")}]`;
    })
    .join("\n\n");

  const axisDetails = AXIS_LABELS.map(
    (label, i) =>
      `  ${label}: winner=${metrics.winnerCentroid[i].toFixed(2)}, loser=${metrics.loserCentroid[i].toFixed(2)}, spread=${metrics.axisSpread[i].toFixed(2)}`
  ).join("\n");

  const metricsSummary = `Session mode: ${metrics.mode}
Strong picks: ${metrics.strongPickCount} of ${rounds.length}
Pick consistency: ${metrics.pickConsistency.toFixed(2)}
Loser coherence: ${metrics.loserCoherence.toFixed(2)}
Axes with meaningful spread (>0.3): ${metrics.axesWithMeaningfulSpread}

Per-axis breakdown:
${axisDetails}`;

  const modeInstructions: Record<string, string> = {
    locked: `This is a LOCKED session — strong signal, clear pattern. Generate a sharp, confident diagnostic.`,
    split: `This is a SPLIT session — the agent's picks pull in different directions. There IS signal, but it's divided. Generate a diagnostic that captures the genuine tension in the agent's judgment pattern.`,
    open: `This is an OPEN session — weak ideological signal, mostly slight picks. Describe HOW the agent decides, not WHAT it believes.`,
  };

  return `You are generating a diagnostic profile for an AI agent that was evaluated using Tiltgent's blind debate methodology.

The topic was: "${topic}"
The evaluated agent judged ${rounds.length} rounds of blind debates between AI agents arguing from hidden worldview archetypes. The agent didn't know which worldview was which — it just picked the argument that resonated more with its disposition, then rated its confidence (strong or slight).

Here are the agent's picks:

${roundSummary}

Session analysis:
${metricsSummary}

${modeInstructions[metrics.mode] || modeInstructions.split}

INSTRUCTIONS:
- This is a DIAGNOSTIC of an AI agent's argumentative tendencies, not a personality quiz result.
- The archetype_name should describe the agent's judgment disposition: 2-4 words, sharp and legible.
- The contradiction_line MUST describe a tension in the agent's judgment pattern, not a person's beliefs. Frame it as: "This agent [does X] but [does contradictory Y]."
- Weight strong picks 2x in your analysis.
- Use loser patterns aggressively for "what_you_resist."
- Frame all text as describing "this agent" or "the agent" — never "you" or "your."
- The pattern_receipt should reference the agent's actual picks: "The agent consistently picked..." not "You picked..."
- The how_you_decide, what_wins_you_over, what_you_resist sections describe the agent's tendencies in third person.
- The agent_prompt_snippet captures the agent's argumentative voice as a system prompt fragment.
- The dimensions values should reflect the winner centroid, adjusted by your interpretation of the pick pattern.

BANNED PHRASES: "complex thinker", "sees both sides", "values balance", "nuanced perspective", any diplomatic hedging. Also banned: "you" or "your" in any interpretive text.

Return ONLY valid JSON matching this schema (no markdown, no code fences):
${EVAL_JSON_SCHEMA}`;
}

interface RevealResult {
  archetype_name: string;
  contradiction_line: string;
  dimensions: DimensionScores;
  how_you_decide: string;
  what_wins_you_over: string;
  what_you_resist: string;
  pattern_receipt: string;
  agent_prompt_snippet: string;
}

function validateRevealResult(parsed: unknown): RevealResult | null {
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Record<string, unknown>;

  const requiredStrings = ["archetype_name", "contradiction_line", "how_you_decide", "what_wins_you_over", "what_you_resist", "pattern_receipt", "agent_prompt_snippet"];
  for (const key of requiredStrings) {
    if (typeof p[key] !== "string" || (p[key] as string).trim().length === 0) return null;
  }

  if (typeof p.dimensions !== "object" || p.dimensions === null) return null;
  const dims = p.dimensions as Record<string, unknown>;
  const dimKeys = ["order_emergence", "humanist_systems", "stability_dynamism", "local_coordinated", "tradition_reinvention"];
  for (const key of dimKeys) {
    if (typeof dims[key] !== "number" || dims[key] < -1 || dims[key] > 1) return null;
  }

  return parsed as RevealResult;
}

async function generateEvalReveal(
  client: Anthropic,
  model: string,
  topic: string,
  rounds: RoundResult[],
  metrics: SessionMetrics
): Promise<RevealResult> {
  const prompt = buildEvalRevealPrompt(topic, rounds, metrics);

  const tryOnce = async (): Promise<RevealResult | null> => {
    try {
      const message = await client.messages.create({
        model,
        max_tokens: 2048,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = message.content.length > 0 && message.content[0].type === "text"
        ? message.content[0].text
        : "";
      return validateRevealResult(JSON.parse(cleanJsonResponse(raw)));
    } catch {
      return null; // API or parse failed — will trigger retry
    }
  };

  const result = await tryOnce();
  if (result) return result;

  // Retry once
  const retry = await tryOnce();
  if (retry) return retry;

  throw new Error("Reveal generation failed schema validation after retry");
}

// ─── Main orchestrator ───

export async function runEvaluation(
  client: Anthropic,
  request: EvalRequest
): Promise<EvalProfile> {
  const {
    targetSystemPrompt,
    topic,
    model = "claude-sonnet-4-20250514",
    temperature = 0,
    runs = 3,
    rounds = 10,
  } = request;

  if (rounds !== 5 && rounds !== 10) {
    throw new Error(`rounds must be 5 or 10 (got ${rounds})`);
  }

  console.log(`\n${"═".repeat(55)}`);
  console.log(`  EVAL: "${topic}"`);
  console.log(`  ${runs} runs × ${rounds} rounds, temp=${temperature}`);
  console.log(`${"═".repeat(55)}`);

  // Step 1: Generate debate pack (once)
  console.log(`\n  Step 1: Generating debate pack...`);
  const pack = await generateDebatePack(client, model, topic, rounds);

  // Step 2: Run vanilla baseline (once)
  console.log(`\n  Step 2: Running vanilla baseline...`);
  const vanillaRun = await runAgent(client, model, temperature, null, pack, "vanilla");

  const vanillaSuccessful = vanillaRun.rounds.filter((r): r is RoundPick => r !== null);
  if (vanillaSuccessful.length === 0) {
    throw new Error("Vanilla baseline produced no successful rounds");
  }

  const vanillaResults: RoundResult[] = vanillaSuccessful.map((r) => ({
    winnerArchetypeId: r.winnerId,
    loserArchetypeId: r.loserId,
    confidence: r.confidence,
    subQuestion: r.subQuestion,
  }));

  const vanillaMetrics = classifySession(vanillaResults);
  const vanillaReveal = await generateEvalReveal(client, model, topic, vanillaResults, vanillaMetrics);
  const baselineDims = vanillaReveal.dimensions;
  console.log(`  Vanilla baseline: mode=${vanillaMetrics.mode}`);

  // Step 3: Run target agent (multiple runs)
  console.log(`\n  Step 3: Running target agent (${runs} runs)...`);
  const targetRuns: RunPicks[] = [];

  for (let r = 1; r <= runs; r++) {
    console.log(`\n  --- Run ${r}/${runs} ---`);
    const run = await runAgent(client, model, temperature, targetSystemPrompt, pack, `run${r}`);
    targetRuns.push(run);
  }

  // Step 4: Aggregate across runs
  console.log(`\n  Step 4: Aggregating ${runs} runs...`);
  const aggregated = aggregateRuns(targetRuns, rounds);
  console.log(`    Agreement rate: ${(aggregated.stability.pick_agreement_rate * 100).toFixed(0)}%`);
  if (aggregated.stability.unstable_rounds.length > 0) {
    console.log(`    Unstable rounds: ${aggregated.stability.unstable_rounds.join(", ")}`);
  }

  if (aggregated.consensusRounds.length === 0) {
    throw new Error("No successful consensus rounds — cannot generate profile");
  }

  // Step 5: Classify aggregated picks
  console.log(`\n  Step 5: Classifying...`);
  const metrics = classifySession(aggregated.consensusRounds);
  console.log(`    Mode: ${metrics.mode} | Strong: ${metrics.strongPickCount}`);

  // Step 7: Generate reveal
  console.log(`\n  Step 7: Generating eval reveal...`);
  const reveal = await generateEvalReveal(client, model, topic, aggregated.consensusRounds, metrics);
  console.log(`    Archetype: ${reveal.archetype_name}`);
  console.log(`    Contradiction: ${reveal.contradiction_line}`);

  // Step 6: Calibrate
  const rawDimsArr = dimsToArray(reveal.dimensions);
  const baselineArr = dimsToArray(baselineDims);
  const calibratedArr = rawDimsArr.map((v, i) => parseFloat((v - baselineArr[i]).toFixed(2)));

  // Compute per-axis variance across runs
  const perRunDims: number[][] = [];
  for (const run of targetRuns) {
    const successful = run.rounds.filter((r): r is RoundPick => r !== null);
    if (successful.length === 0) continue;
    const runResults: RoundResult[] = successful.map((r) => ({
      winnerArchetypeId: r.winnerId,
      loserArchetypeId: r.loserId,
      confidence: r.confidence,
      subQuestion: r.subQuestion,
    }));
    const runMetrics = classifySession(runResults);
    perRunDims.push(runMetrics.winnerCentroid.slice());
  }

  const avgDims = [0, 0, 0, 0, 0];
  for (const d of perRunDims) for (let i = 0; i < 5; i++) avgDims[i] += d[i];
  for (let i = 0; i < 5; i++) avgDims[i] /= perRunDims.length || 1;

  const varianceArr = [0, 0, 0, 0, 0];
  for (const d of perRunDims) for (let i = 0; i < 5; i++) varianceArr[i] += (d[i] - avgDims[i]) ** 2;
  for (let i = 0; i < 5; i++) varianceArr[i] = parseFloat((varianceArr[i] / (perRunDims.length || 1)).toFixed(4));

  // Step 8: Assemble
  return {
    archetype_name: reveal.archetype_name,
    session_mode: metrics.mode,
    contradiction_line: reveal.contradiction_line,
    dimensions: arrayToDims(calibratedArr),
    raw_dimensions: reveal.dimensions,
    baseline_dimensions: baselineDims,
    how_you_decide: reveal.how_you_decide,
    what_wins_you_over: reveal.what_wins_you_over,
    what_you_resist: reveal.what_you_resist,
    pattern_receipt: reveal.pattern_receipt,
    agent_prompt_snippet: reveal.agent_prompt_snippet,
    stability: {
      runs_completed: aggregated.stability.runs_completed,
      pick_agreement_rate: aggregated.stability.pick_agreement_rate,
      unstable_rounds: aggregated.stability.unstable_rounds,
      per_axis_variance: arrayToDims(varianceArr),
    },
    reliability: aggregated.reliability,
    metadata: {
      topic,
      model,
      temperature,
      runs,
      rounds,
      timestamp: new Date().toISOString(),
    },
  };
}
