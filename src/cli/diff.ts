import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import type { EvalProfile } from '../engine/eval-pipeline.js';
import { formatDiffOutput } from './format.js';

// ─── Significance thresholds for dimension shifts ───
// These are initial values based on the engine's validated output.
// Tune based on real-world usage.
const THRESHOLD_NOTABLE = 0.15;     // worth watching
const THRESHOLD_SIGNIFICANT = 0.3;  // measurable change
const THRESHOLD_MAJOR = 0.5;        // dramatic shift

export type Significance = 'none' | 'notable' | 'significant' | 'major';

function classifyDelta(delta: number): Significance {
  const abs = Math.abs(delta);
  if (abs >= THRESHOLD_MAJOR) return 'major';
  if (abs >= THRESHOLD_SIGNIFICANT) return 'significant';
  if (abs >= THRESHOLD_NOTABLE) return 'notable';
  return 'none';
}

// ─── Dimension axis labels ───
// Match the real EvalProfile dimension keys
const DIMENSION_AXES = [
  { key: 'order_emergence', label: 'Order <-> Emergence', negative: 'toward Order', positive: 'toward Emergence' },
  { key: 'humanist_systems', label: 'Humanist <-> Systems', negative: 'toward Humanist', positive: 'toward Systems' },
  { key: 'stability_dynamism', label: 'Stability <-> Dynamism', negative: 'toward Stability', positive: 'toward Dynamism' },
  { key: 'local_coordinated', label: 'Local <-> Coordinated', negative: 'toward Local', positive: 'toward Coordinated' },
  { key: 'tradition_reinvention', label: 'Tradition <-> Reinvention', negative: 'toward Tradition', positive: 'toward Reinvention' },
] as const;

// ─── DiffReport type ───

export interface DimensionDiff {
  name: string;
  before: number;
  after: number;
  delta: number;
  significance: Significance;
  direction: string;
}

export interface StabilitySnapshot {
  pickAgreement: number;
  unstableRounds: number;
  totalRounds: number;
  parseReliability: string;
}

export interface DiffReport {
  beforeFile: string;
  afterFile: string;
  beforeTopic: string;
  afterTopic: string;
  timestamp: string;

  archetypeChanged: boolean;
  archetypeBefore: string;
  archetypeAfter: string;

  dimensions: DimensionDiff[];
  totalAbsoluteDrift: number;

  sessionModeBefore: string;
  sessionModeAfter: string;
  sessionModeChanged: boolean;

  contradictionBefore: string;
  contradictionAfter: string;
  contradictionChanged: boolean;

  stabilityBefore: StabilitySnapshot;
  stabilityAfter: StabilitySnapshot;
}

// ─── Helpers ───

function parseReliabilityString(profile: EvalProfile): string {
  const total = profile.reliability.parse_layer_distribution;
  const sum = total.layer1 + total.layer2 + total.layer3;
  if (sum === 0) return 'N/A';
  const l1Pct = ((total.layer1 / sum) * 100).toFixed(0);
  return `Layer 1 ${l1Pct}%`;
}

function stabilitySnapshot(profile: EvalProfile): StabilitySnapshot {
  return {
    pickAgreement: profile.stability.pick_agreement_rate,
    unstableRounds: profile.stability.unstable_rounds.length,
    totalRounds: profile.metadata.rounds,
    parseReliability: parseReliabilityString(profile),
  };
}

function validateProfile(data: unknown, filename: string): EvalProfile | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;

  // Minimum required fields
  if (typeof d.archetype_name !== 'string') return null;
  if (typeof d.contradiction_line !== 'string') return null;
  if (typeof d.dimensions !== 'object' || d.dimensions === null) return null;

  const dims = d.dimensions as Record<string, unknown>;
  for (const axis of DIMENSION_AXES) {
    if (typeof dims[axis.key] !== 'number') return null;
  }

  return data as EvalProfile;
}

// ─── Compute diff ───

function computeDiff(before: EvalProfile, after: EvalProfile, beforeFile: string, afterFile: string): DiffReport {
  const dimensions: DimensionDiff[] = DIMENSION_AXES.map(axis => {
    const bVal = (before.dimensions as unknown as Record<string, number>)[axis.key];
    const aVal = (after.dimensions as unknown as Record<string, number>)[axis.key];
    const delta = parseFloat((aVal - bVal).toFixed(4));
    const significance = classifyDelta(delta);
    let direction = 'no change';
    if (Math.abs(delta) >= THRESHOLD_NOTABLE) {
      direction = delta > 0 ? axis.positive : axis.negative;
    }
    return { name: axis.label, before: bVal, after: aVal, delta, significance, direction };
  });

  const totalAbsoluteDrift = parseFloat(
    dimensions.reduce((sum, d) => sum + Math.abs(d.delta), 0).toFixed(4)
  );

  return {
    beforeFile,
    afterFile,
    beforeTopic: before.metadata?.topic ?? 'unknown',
    afterTopic: after.metadata?.topic ?? 'unknown',
    timestamp: new Date().toISOString(),

    archetypeChanged: before.archetype_name !== after.archetype_name,
    archetypeBefore: before.archetype_name,
    archetypeAfter: after.archetype_name,

    dimensions,
    totalAbsoluteDrift,

    sessionModeBefore: before.session_mode,
    sessionModeAfter: after.session_mode,
    sessionModeChanged: before.session_mode !== after.session_mode,

    contradictionBefore: before.contradiction_line,
    contradictionAfter: after.contradiction_line,
    contradictionChanged: before.contradiction_line !== after.contradiction_line,

    stabilityBefore: stabilitySnapshot(before),
    stabilityAfter: stabilitySnapshot(after),
  };
}

// ─── Command handler ───

interface DiffOptions {
  out?: string;
}

export async function diffCommand(beforePath: string, afterPath: string, options: DiffOptions): Promise<void> {
  // 1. Validate files exist
  const resolvedBefore = path.resolve(beforePath);
  const resolvedAfter = path.resolve(afterPath);

  if (!fs.existsSync(resolvedBefore)) {
    console.error(chalk.red(`Error: File not found: ${beforePath}`));
    process.exit(1);
  }
  if (!fs.existsSync(resolvedAfter)) {
    console.error(chalk.red(`Error: File not found: ${afterPath}`));
    process.exit(1);
  }

  // 2. Parse JSON
  let beforeRaw: unknown;
  let afterRaw: unknown;

  try {
    beforeRaw = JSON.parse(fs.readFileSync(resolvedBefore, 'utf-8'));
  } catch {
    console.error(chalk.red(`Error: Could not parse ${beforePath} as valid JSON.`));
    process.exit(1);
  }

  try {
    afterRaw = JSON.parse(fs.readFileSync(resolvedAfter, 'utf-8'));
  } catch {
    console.error(chalk.red(`Error: Could not parse ${afterPath} as valid JSON.`));
    process.exit(1);
  }

  // 3. Validate profiles
  const before = validateProfile(beforeRaw, beforePath);
  if (!before) {
    console.error(chalk.red(`Error: Could not parse ${beforePath} as a valid Tiltgent profile.`));
    process.exit(1);
  }

  const after = validateProfile(afterRaw, afterPath);
  if (!after) {
    console.error(chalk.red(`Error: Could not parse ${afterPath} as a valid Tiltgent profile.`));
    process.exit(1);
  }

  // 4. Warn on different topics
  if (before.metadata?.topic && after.metadata?.topic && before.metadata.topic !== after.metadata.topic) {
    console.log(chalk.yellow(`\n  Note: These profiles are from different topics (${before.metadata.topic} vs. ${after.metadata.topic}). Cross-topic comparison is valid but dimensions may not be directly comparable.\n`));
  }

  // 5. Compute diff
  const report = computeDiff(before, after, beforePath, afterPath);

  // 6. Print formatted output
  formatDiffOutput(report);

  // 7. Save JSON if requested
  if (options.out) {
    const outputPath = path.resolve(options.out);
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(chalk.green(`  Diff report saved to ${options.out}`));
    console.log('');
  }
}
