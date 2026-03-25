import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { formatTerminalOutput } from './format.js';
import { validateEvalProfile } from './profile-validation.js';
import { sanitizeInlineText } from '../terminal-safety.js';
import { CliError } from './errors.js';
import type { EvalProfile } from '../engine/eval-pipeline.js';

export async function inspectCommand(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    throw new CliError(`File not found: ${sanitizeInlineText(filePath)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch {
    throw new CliError(`Could not parse ${sanitizeInlineText(filePath)} as valid JSON.`);
  }

  if (!validateEvalProfile(raw)) {
    throw new CliError(`Could not parse ${sanitizeInlineText(filePath)} as a valid Tiltgent profile.`);
  }

  formatTerminalOutput(raw as EvalProfile);
  console.log(chalk.dim(`  Source: ${sanitizeInlineText(filePath)}`));
  console.log('');
}
