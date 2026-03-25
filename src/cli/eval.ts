import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import chalk from 'chalk';
import ora from 'ora';
import { runEvaluation } from '../engine/eval-pipeline.js';
import { formatTerminalOutput } from './format.js';

const amber = chalk.hex('#F59E0B');

interface EvalOptions {
  prompt: string;
  topic?: string;
  questions?: string;
  rounds: string;
  out?: string;
  apiKey?: string;
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
  const apiKey = options.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('Error: No Anthropic API key found. Set ANTHROPIC_API_KEY or use --api-key'));
    process.exit(1);
  }

  // Prompt file
  const promptPath = path.resolve(options.prompt);
  if (!fs.existsSync(promptPath)) {
    console.error(chalk.red(`Error: Prompt file not found: ${options.prompt}`));
    process.exit(1);
  }

  // Topic or questions
  if (!options.topic && !options.questions) {
    console.error(chalk.red('Error: Either --topic or --questions is required'));
    process.exit(1);
  }

  if (options.questions) {
    console.error(chalk.red('Error: --questions is not yet supported. Use --topic instead.'));
    process.exit(1);
  }

  // Rounds
  const rounds = parseInt(options.rounds, 10);
  if (rounds !== 5 && rounds !== 10) {
    console.error(chalk.red('Error: Rounds must be 5 or 10'));
    process.exit(1);
  }

  // 2. Read the prompt file
  const systemPrompt = fs.readFileSync(promptPath, 'utf-8').trim();
  if (systemPrompt.length === 0) {
    console.error(chalk.red('Error: Prompt file is empty'));
    process.exit(1);
  }

  // 3. Print startup banner
  const topic = options.topic!;
  const estimatedMinutes = rounds === 10 ? '4-6' : '2-3';
  const estimatedCost = rounds === 10 ? '~$0.25-0.30' : '~$0.12-0.15';

  console.log('');
  console.log(amber('  TILTGENT'));
  console.log(`  Prompt: ${chalk.white(options.prompt)} (${systemPrompt.length} chars)`);
  console.log(`  Topic:  ${chalk.white(topic)}`);
  console.log(`  Rounds: ${chalk.white(String(rounds))} | Runs: ${chalk.white('3')}`);
  console.log(`  Est:    ${estimatedMinutes} min | ${estimatedCost}`);
  console.log('');

  // 4. Initialize Anthropic client
  const client = new Anthropic({ apiKey });

  // 5. Run the evaluation
  // The engine has its own console.log progress output, which works well
  // in the terminal. We add a spinner only for the overall eval.
  const spinner = ora({
    text: 'Running evaluation...',
    color: 'yellow',
  }).start();

  // Temporarily suppress engine console.log during spinner,
  // then show it all. Actually — the engine logs are useful progress.
  // Stop spinner, let engine logs flow, then show formatted result.
  spinner.stop();

  try {
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
    console.log(chalk.green(`  Result saved to ${outputPath}`));
    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('');
    console.error(chalk.red(`  Evaluation failed: ${message}`));
    process.exit(1);
  }
}
