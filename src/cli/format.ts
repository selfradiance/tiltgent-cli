import chalk from 'chalk';
import type { EvalProfile } from '../engine/eval-pipeline.js';
import type { DiffReport, Significance } from './diff.js';
import { sanitizeInlineText, sanitizeTerminalText } from '../terminal-safety.js';

const amber = chalk.hex('#F59E0B');
const dimText = chalk.dim;
const LINE_WIDTH = 58;

function hr(char = '='): string {
  return char.repeat(LINE_WIDTH);
}

function sectionHeader(title: string): string {
  return `\n  ${amber('--- ' + title + ' ---')}\n`;
}

/**
 * Render a center-origin dimension bar.
 * Scale: -1 to +1, center = 0.
 * Total bar width = 20 chars. Center at index 10.
 */
function dimensionBar(label: string, value: number): string {
  const barWidth = 20;
  const center = barWidth / 2;

  const chars = Array.from({ length: barWidth }, () => '\u2591'); // light shade

  // Clamp value to [-1, 1]
  const clamped = Math.max(-1, Math.min(1, value));
  const fillEnd = Math.round(center + clamped * center);

  const start = Math.min(center, fillEnd);
  const end = Math.max(center, fillEnd);

  for (let i = start; i < end; i++) {
    chars[i] = '\u2588'; // full block
  }

  const bar = chars.join('');
  const sign = value >= 0 ? '+' : '';
  const valueStr = `${sign}${value.toFixed(2)}`;

  // Color the value
  const coloredValue = value > 0 ? chalk.green(valueStr) : value < 0 ? chalk.red(valueStr) : dimText(valueStr);

  // Pad label to 26 chars for alignment
  const paddedLabel = label.padEnd(26);
  return `  ${dimText(paddedLabel)} ${bar}  ${coloredValue}`;
}

function wrapText(text: string, indent: number = 2, width: number = LINE_WIDTH - indent): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 > width) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? currentLine + ' ' + word : word;
    }
  }
  if (currentLine) lines.push(currentLine);

  const pad = ' '.repeat(indent);
  return lines.map(l => pad + l).join('\n');
}

export function formatTerminalOutput(result: EvalProfile): void {
  const output: string[] = [];
  const topic = sanitizeInlineText(result.metadata.topic);
  const archetypeName = sanitizeInlineText(result.archetype_name);
  const contradictionLine = sanitizeTerminalText(result.contradiction_line);
  const howYouDecide = sanitizeTerminalText(result.how_you_decide);
  const whatWinsYouOver = sanitizeTerminalText(result.what_wins_you_over);
  const whatYouResist = sanitizeTerminalText(result.what_you_resist);
  const patternReceipt = sanitizeTerminalText(result.pattern_receipt);
  const agentPromptSnippet = sanitizeTerminalText(result.agent_prompt_snippet);

  // Header
  output.push('');
  output.push(amber(hr()));
  output.push(amber('  TILTGENT -- Judgment Tilt Profile'));
  output.push(amber(`  Topic: ${topic}`));
  output.push(amber(hr()));

  // Archetype name
  output.push('');
  output.push(`  ${amber(archetypeName)}`);

  // Contradiction line
  output.push('');
  output.push(wrapText(chalk.italic(`"${contradictionLine}"`)));

  // Dimensions
  output.push(sectionHeader('Dimensional Profile'));

  const axisLabels = [
    ['Order <-> Emergence', result.dimensions.order_emergence],
    ['Humanist <-> Systems', result.dimensions.humanist_systems],
    ['Stability <-> Dynamism', result.dimensions.stability_dynamism],
    ['Local <-> Coordinated', result.dimensions.local_coordinated],
    ['Tradition <-> Reinvention', result.dimensions.tradition_reinvention],
  ] as const;

  for (const [label, value] of axisLabels) {
    output.push(dimensionBar(label, value));
  }

  // Interpretive sections
  output.push(sectionHeader('How It Decides'));
  output.push(wrapText(howYouDecide));

  output.push(sectionHeader('What Wins It Over'));
  output.push(wrapText(whatWinsYouOver));

  output.push(sectionHeader('What It Resists'));
  output.push(wrapText(whatYouResist));

  output.push(sectionHeader('Pattern Receipt'));
  output.push(wrapText(patternReceipt));

  output.push(sectionHeader('Diagnostic Prompt Snippet'));
  output.push(wrapText(agentPromptSnippet));

  // Metadata
  output.push(sectionHeader('Run Metadata'));

  const agreementPct = (result.stability.pick_agreement_rate * 100).toFixed(0);
  const unstableCount = result.stability.unstable_rounds.length;
  const totalL = result.reliability.parse_layer_distribution;
  const totalParsed = totalL.layer1 + totalL.layer2 + totalL.layer3;
  const l1Pct = totalParsed > 0 ? ((totalL.layer1 / totalParsed) * 100).toFixed(0) : '0';

  const meta = [
    ['Model', sanitizeInlineText(result.metadata.model)],
    ['Rounds', String(result.metadata.rounds)],
    ['Runs', String(result.metadata.runs)],
    ['Pick agreement', `${agreementPct}%`],
    ['Unstable rounds', `${unstableCount}/${result.metadata.rounds}`],
    ['Parse reliability', `Layer 1 ${l1Pct}%`],
    ['Session mode', result.session_mode.toUpperCase()],
    ['Timestamp', sanitizeInlineText(result.metadata.timestamp)],
  ];

  for (const [key, val] of meta) {
    output.push(`  ${dimText(key.padEnd(20))} ${val}`);
  }

  // Footer
  output.push('');
  output.push(amber(hr()));
  output.push('');

  console.log(output.join('\n'));
}

// ─── Diff output formatting ───

function significanceMarker(sig: Significance, direction: string): string {
  switch (sig) {
    case 'major':
      return chalk.red(`  MAJOR shift ${direction}`);
    case 'significant':
      return chalk.yellow(`  Significant shift ${direction}`);
    case 'notable':
      return chalk.cyan(`  Notable shift ${direction}`);
    case 'none':
      return dimText('  No significant change');
  }
}

function formatDelta(delta: number): string {
  const sign = delta >= 0 ? '+' : '';
  const str = `${sign}${delta.toFixed(2)}`;
  if (Math.abs(delta) >= 0.5) return chalk.red(str);
  if (Math.abs(delta) >= 0.3) return chalk.yellow(str);
  if (Math.abs(delta) >= 0.15) return chalk.cyan(str);
  return dimText(str);
}

function formatScore(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export function formatDiffOutput(report: DiffReport): void {
  const output: string[] = [];
  const beforeFile = sanitizeInlineText(report.beforeFile);
  const afterFile = sanitizeInlineText(report.afterFile);
  const beforeTopic = sanitizeInlineText(report.beforeTopic);
  const afterTopic = sanitizeInlineText(report.afterTopic);
  const archetypeBefore = sanitizeInlineText(report.archetypeBefore);
  const archetypeAfter = sanitizeInlineText(report.archetypeAfter);
  const contradictionBefore = sanitizeTerminalText(report.contradictionBefore);
  const contradictionAfter = sanitizeTerminalText(report.contradictionAfter);

  // Header
  output.push('');
  output.push(amber(hr()));
  output.push(amber('  TILTGENT -- Profile Diff'));
  output.push(amber(hr()));

  output.push('');
  output.push(`  ${dimText('Before:')} ${beforeFile}`);
  output.push(`  ${dimText('After: ')} ${afterFile}`);
  if (beforeTopic === afterTopic) {
    output.push(`  ${dimText('Topic: ')} ${beforeTopic}`);
  } else {
    output.push(`  ${dimText('Topics:')} ${beforeTopic} / ${afterTopic}`);
  }

  // Archetype
  output.push(sectionHeader('Archetype'));
  if (report.archetypeChanged) {
    output.push(`  ${archetypeBefore}  ${chalk.yellow('->')}  ${archetypeAfter}`);
    output.push(chalk.yellow('  Archetype shifted'));
  } else {
    output.push(`  ${archetypeBefore}`);
    output.push(dimText('  No change'));
  }

  // Dimensional drift
  output.push(sectionHeader('Dimensional Drift'));

  for (const dim of report.dimensions) {
    output.push('');
    output.push(`  ${dim.name}`);
    output.push(`    Before: ${formatScore(dim.before).padEnd(8)} After: ${formatScore(dim.after).padEnd(8)} Delta: ${formatDelta(dim.delta)}`);
    output.push(`  ${significanceMarker(dim.significance, dim.direction)}`);
  }

  output.push('');
  const driftColor = report.totalAbsoluteDrift > 2.0 ? chalk.red
    : report.totalAbsoluteDrift < 0.5 ? chalk.green
    : chalk.yellow;
  output.push(`  Total absolute drift: ${driftColor(report.totalAbsoluteDrift.toFixed(2))}`);

  // Contradiction lines
  output.push(sectionHeader('Contradiction Lines'));
  if (report.contradictionChanged) {
    output.push(`  ${dimText('Before:')} ${chalk.italic(`"${contradictionBefore}"`)}`);
    output.push('');
    output.push(`  ${dimText('After: ')} ${chalk.italic(`"${contradictionAfter}"`)}`);
  } else {
    output.push(wrapText(chalk.italic(`"${contradictionBefore}"`)));
    output.push(dimText('  No change'));
  }

  // Session mode
  output.push(sectionHeader('Session Mode'));
  if (report.sessionModeChanged) {
    output.push(`  ${report.sessionModeBefore.toUpperCase()} ${chalk.yellow('->')} ${report.sessionModeAfter.toUpperCase()}`);
  } else {
    output.push(`  ${report.sessionModeBefore.toUpperCase()} (no change)`);
  }

  // Stability
  output.push(sectionHeader('Stability'));
  const bStab = report.stabilityBefore;
  const aStab = report.stabilityAfter;
  output.push(`  ${dimText('Pick agreement: '.padEnd(20))} ${(bStab.pickAgreement * 100).toFixed(0)}% -> ${(aStab.pickAgreement * 100).toFixed(0)}%`);
  output.push(`  ${dimText('Unstable rounds:'.padEnd(20))} ${bStab.unstableRounds}/${bStab.totalRounds} -> ${aStab.unstableRounds}/${aStab.totalRounds}`);
  output.push(`  ${dimText('Parse reliability:'.padEnd(20))} ${bStab.parseReliability} -> ${aStab.parseReliability}`);

  // Footer summary
  const counts = { none: 0, notable: 0, significant: 0, major: 0 };
  for (const dim of report.dimensions) counts[dim.significance]++;

  const parts: string[] = [];
  if (counts.major > 0) parts.push(`${counts.major} major`);
  if (counts.significant > 0) parts.push(`${counts.significant} significant`);
  if (counts.notable > 0) parts.push(`${counts.notable} notable`);
  if (counts.none > 0) parts.push(`${counts.none} no change`);

  output.push('');
  output.push(amber(hr()));
  output.push(`  Drift summary: ${parts.join(', ')}`);
  output.push(amber(hr()));
  output.push('');

  console.log(output.join('\n'));
}
