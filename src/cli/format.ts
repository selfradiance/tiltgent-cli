import chalk from 'chalk';
import type { EvalProfile } from '../engine/eval-pipeline.js';

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

  // Header
  output.push('');
  output.push(amber(hr()));
  output.push(amber('  TILTGENT -- Judgment Tilt Profile'));
  output.push(amber(`  Topic: ${result.metadata.topic}`));
  output.push(amber(hr()));

  // Archetype name
  output.push('');
  output.push(`  ${amber(result.archetype_name)}`);

  // Contradiction line
  output.push('');
  output.push(wrapText(chalk.italic(`"${result.contradiction_line}"`)));

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
  output.push(wrapText(result.how_you_decide));

  output.push(sectionHeader('What Wins It Over'));
  output.push(wrapText(result.what_wins_you_over));

  output.push(sectionHeader('What It Resists'));
  output.push(wrapText(result.what_you_resist));

  output.push(sectionHeader('Pattern Receipt'));
  output.push(wrapText(result.pattern_receipt));

  output.push(sectionHeader('Diagnostic Prompt Snippet'));
  output.push(wrapText(result.agent_prompt_snippet));

  // Metadata
  output.push(sectionHeader('Run Metadata'));

  const agreementPct = (result.stability.pick_agreement_rate * 100).toFixed(0);
  const unstableCount = result.stability.unstable_rounds.length;
  const totalL = result.reliability.parse_layer_distribution;
  const totalParsed = totalL.layer1 + totalL.layer2 + totalL.layer3;
  const l1Pct = totalParsed > 0 ? ((totalL.layer1 / totalParsed) * 100).toFixed(0) : '0';

  const meta = [
    ['Model', result.metadata.model],
    ['Rounds', String(result.metadata.rounds)],
    ['Runs', String(result.metadata.runs)],
    ['Pick agreement', `${agreementPct}%`],
    ['Unstable rounds', `${unstableCount}/${result.metadata.rounds}`],
    ['Parse reliability', `Layer 1 ${l1Pct}%`],
    ['Session mode', result.session_mode.toUpperCase()],
    ['Timestamp', result.metadata.timestamp],
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
