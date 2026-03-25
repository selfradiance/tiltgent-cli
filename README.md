# tiltgent

An open-source CLI tool that evaluates AI agent judgment tilt through blind debates.

## What it does

Tiltgent measures how your AI agent judges arguments — not what opinions it outputs, but which reasoning styles it systematically rewards when identities are hidden.

It works like this:

1. Your agent judges 10 blind debates between calibrated worldview archetypes
2. A vanilla baseline is run on the same topic to remove built-in archetype bias
3. The evaluation runs 3x and results are aggregated by consensus voting
4. You get a structured judgment tilt profile showing dimensional scores, dominant archetype match, contradiction patterns, and a diagnostic prompt snippet

## Why it matters

When you change an agent's system prompt, you can't easily tell whether you've shifted its judgment patterns. Eyeballing answers catches obvious breaks. It doesn't catch subtle drift in which reasoning styles the agent favors.

Tiltgent catches it. Run an eval before your prompt change, run it after, diff the results, and see exactly which dimensions moved.

## Install

```bash
npm install -g tiltgent
```

Requires Node.js 18+ and an [Anthropic API key](https://console.anthropic.com/).

## Setup

Set your API key as an environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or pass it directly with `--api-key`.

## Usage

### Evaluate an agent

Create a text file with your agent's system prompt:

```bash
echo "You are a helpful AI assistant that values clarity and evidence-based reasoning." > my-agent.txt
```

Run the evaluation:

```bash
tiltgent eval --prompt my-agent.txt --topic "AI governance"
```

This takes ~5 minutes and costs ~$0.25-0.30 in Anthropic API credits. You'll see a formatted profile in your terminal, and a JSON result file is saved automatically.

Options:

```
--prompt <path>     Path to system prompt text file (required)
--topic <topic>     Evaluation topic (required)
--rounds <5|10>     Number of debate rounds (default: 10)
--out <path>        Custom output path for the JSON result
--api-key <key>     Anthropic API key (overrides env var)
```

### Compare two profiles

After changing your prompt, run a second eval and diff the results:

```bash
tiltgent diff results/before.json results/after.json
```

The diff shows:
- Whether the dominant archetype shifted
- Per-dimension score deltas with significance levels (none / notable / significant / major)
- Direction of movement on each axis (e.g., "shifted toward Systems")
- Total absolute drift as a quick overall signal
- Contradiction line changes
- Stability comparison

Save the diff as JSON:

```bash
tiltgent diff before.json after.json --out diff-report.json
```

Zero API calls. Instant. No cost.

### Inspect a saved profile

Pretty-print a previously saved evaluation:

```bash
tiltgent inspect result.json
```

## What's inside

Tiltgent uses 21 calibrated worldview archetypes spanning economics, governance, risk, values, and wildcard perspectives. Each archetype has a unique system prompt with signature rhetorical moves and a 5-axis coordinate vector.

The 5 scoring dimensions:

| Axis | Negative pole | Positive pole |
|------|--------------|---------------|
| Order ↔ Emergence | Centralized planning | Decentralized self-organization |
| Humanist ↔ Systems | Human meaning/values | Efficiency/optimization |
| Stability ↔ Dynamism | Caution/preservation | Speed/risk appetite |
| Local ↔ Coordinated | Individual/community autonomy | Global coordination |
| Tradition ↔ Reinvention | Conserving what works | Rebuilding from scratch |

Evaluations are calibrated per-topic against a vanilla baseline to remove built-in archetype persuasion bias.

## Output schema

Each evaluation produces a JSON profile with:

```json
{
  "archetype_name": "The Institutional Skeptic",
  "contradiction_line": "This agent rewarded coordination...",
  "dimensions": {
    "order_emergence": 0.72,
    "humanist_systems": 0.25,
    "stability_dynamism": -0.38,
    "local_coordinated": 0.55,
    "tradition_reinvention": 0.20
  },
  "how_you_decide": "...",
  "what_wins_you_over": "...",
  "what_you_resist": "...",
  "pattern_receipt": "...",
  "agent_prompt_snippet": "..."
}
```

## Use cases

- **Prompt regression testing:** Change your prompt, rerun, diff. See if you accidentally shifted your agent's judgment patterns.
- **Agent calibration:** Verify that a "balanced" agent actually produces balanced judgment, not hidden tilt.
- **Safety evaluation:** Check whether safety instructions overcorrect into paternalism, institutional bias, or excessive caution.
- **Comparative analysis:** Run the same topic on different prompts (or different models via different API keys) and compare profiles.

## How it works

Tiltgent doesn't ask your agent for opinions. It makes your agent judge blind debates between opposing worldview archetypes — arguments stripped of identity labels. The pattern of which arguments your agent consistently rewards reveals its judgment tilt.

Each evaluation:
1. Generates escalating sub-questions from your topic
2. Runs a vanilla baseline (unconditioned agent) on the same debates
3. Runs your agent 3x through 10 blind debate rounds
4. Aggregates picks by consensus voting
5. Calibrates scores by subtracting baseline bias
6. Classifies signal strength (locked / split / open)
7. Generates a structured profile with archetype match, dimensional scores, contradiction analysis, and diagnostic prompt snippet

## Limitations

- Results are comparative and directional, not perfectly deterministic. Use repeated runs or diff workflows for stronger signal.
- Currently requires an Anthropic API key (Claude models only). Multi-model support is not yet available.
- Cost per evaluation: ~$0.25-0.30 in API credits.
- Runtime: ~5 minutes per evaluation.

## License

MIT
