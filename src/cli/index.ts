import { Command } from 'commander';
import { evalCommand } from './eval.js';
import { diffCommand } from './diff.js';
import { inspectCommand } from './inspect.js';

const program = new Command();

program
  .name('tiltgent')
  .description('Evaluate AI agent judgment tilt through blind debates')
  .version('0.1.0');

program
  .command('eval')
  .description('Run a judgment tilt evaluation on an agent system prompt')
  .requiredOption('--prompt <path>', 'Path to a text file containing the agent system prompt')
  .option('--topic <topic>', 'Evaluation topic (e.g., "AI governance")')
  .option('--questions <path>', 'Path to a JSON file with custom sub-questions (coming soon)')
  .option('--rounds <number>', 'Number of debate rounds (5 or 10)', '10')
  .option('--out <path>', 'Output path for the JSON result file')
  .option('--api-key <key>', 'Anthropic API key (defaults to ANTHROPIC_API_KEY env var)')
  .action(evalCommand);

program
  .command('diff')
  .description('Compare two evaluation profiles and show what shifted')
  .argument('<before>', 'Path to baseline evaluation JSON')
  .argument('<after>', 'Path to comparison evaluation JSON')
  .option('--out <path>', 'Save diff report as JSON file')
  .action(diffCommand);

program
  .command('inspect')
  .description('Pretty-print a saved evaluation profile')
  .argument('<file>', 'Path to evaluation JSON file')
  .action(inspectCommand);

program.parse();
