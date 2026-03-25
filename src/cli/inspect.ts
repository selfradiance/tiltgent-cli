import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { formatTerminalOutput } from './format.js';
import type { EvalProfile } from '../engine/eval-pipeline.js';

function validateProfile(data: unknown): data is EvalProfile {
  if (typeof data !== 'object' || data === null) return false;
  const d = data as Record<string, unknown>;

  if (typeof d.archetype_name !== 'string') return false;
  if (typeof d.contradiction_line !== 'string') return false;
  if (typeof d.dimensions !== 'object' || d.dimensions === null) return false;

  const dims = d.dimensions as Record<string, unknown>;
  const requiredDims = ['order_emergence', 'humanist_systems', 'stability_dynamism', 'local_coordinated', 'tradition_reinvention'];
  for (const key of requiredDims) {
    if (typeof dims[key] !== 'number') return false;
  }

  return true;
}

export async function inspectCommand(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);

  if (!fs.existsSync(resolved)) {
    console.error(chalk.red(`Error: File not found: ${filePath}`));
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch {
    console.error(chalk.red(`Error: Could not parse ${filePath} as valid JSON.`));
    process.exit(1);
  }

  if (!validateProfile(raw)) {
    console.error(chalk.red(`Error: Could not parse ${filePath} as a valid Tiltgent profile.`));
    process.exit(1);
  }

  formatTerminalOutput(raw);
  console.log(chalk.dim(`  Source: ${filePath}`));
  console.log('');
}
