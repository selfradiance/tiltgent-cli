import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import { runEvaluation } from '../engine/eval-pipeline.js';
import { formatTerminalOutput } from './format.js';
import { sanitizeInlineText } from '../terminal-safety.js';
import { CliError } from './errors.js';

const amber = chalk.hex('#F59E0B');

const MAX_PROMPT_SIZE = 100 * 1024; // 100KB

interface EvalOptions {
  prompt: string;
  topic?: string;
  questions?: string;
  rounds: string;
  out?: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function generateDefaultOutputPath(topic: string): string {
  const slug = slugify(topic);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `tiltgent-eval-${slug}-${timestamp}.json`;
}

export async function evalCommand(options: EvalOptions): Promise<void> {
  // 1. Validate inputs

  // API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new CliError('No Anthropic API key found. Set ANTHROPIC_API_KEY in your environment.');
  }

  // Prompt file
  const promptPath = path.resolve(options.prompt);
  if (!fs.existsSync(promptPath)) {
    throw new CliError(`Prompt file not found: ${sanitizeInlineText(options.prompt)}`);
  }

  const promptStat = fs.statSync(promptPath);
  if (promptStat.size > MAX_PROMPT_SIZE) {
    throw new CliError(`Prompt file is too large (${(promptStat.size / 1024).toFixed(0)}KB). Maximum is 100KB.`);
  }

  // Topic or questions
  if (!options.topic && !options.questions) {
    throw new CliError('Either --topic or --questions is required');
  }

  if (options.questions) {
    throw new CliError('--questions is not yet supported. Use --topic instead.');
  }

  // Rounds
  const rounds = parseInt(options.rounds, 10);
  if (rounds !== 5 && rounds !== 10) {
    throw new CliError('Rounds must be 5 or 10');
  }

  // 2. Read the prompt file
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  if (systemPrompt.length === 0) {
    throw new CliError('Prompt file is empty');
  }

  // 3. Print startup banner
  const topic = options.topic!;
  const estimatedMinutes = rounds === 10 ? '4-6' : '2-3';
  const estimatedCost = rounds === 10 ? '~$0.25-0.30' : '~$0.12-0.15';

  console.log('');
  console.log(amber('  TILTGENT'));
  console.log(`  Prompt: ${chalk.white(sanitizeInlineText(options.prompt))} (${systemPrompt.length} chars)`);
  console.log(`  Topic:  ${chalk.white(sanitizeInlineText(topic))}`);
  console.log(`  Rounds: ${chalk.white(String(rounds))} | Runs: ${chalk.white('3')}`);
  console.log(`  Est:    ${estimatedMinutes} min | ${estimatedCost}`);
  console.log('');

  // 4. Initialize Anthropic client
  const client = new Anthropic({ apiKey });

  // 5. Run the evaluation (engine logs progress directly to console)
  const result = await runEvaluation(client, {
    targetSystemPrompt: systemPrompt,
    topic,
    rounds: rounds as 5 | 10,
  });

  // 6. Print the formatted terminal output
  formatTerminalOutput(result);

  // 7. Save JSON result
  const outputPath = options.out || generateDefaultOutputPath(topic);
  const resolvedOutput = path.resolve(outputPath);

  // Ensure output directory exists
  const outputDir = path.dirname(resolvedOutput);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(resolvedOutput, JSON.stringify(result, null, 2));
  console.log(chalk.green(`  Result saved to ${sanitizeInlineText(outputPath)}`));
  console.log('');
}
