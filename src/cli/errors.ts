/**
 * Custom error for CLI validation and user-facing errors.
 * Thrown by command handlers, caught at the top level in index.ts.
 * This avoids calling process.exit() inside command handlers,
 * making them testable and safe for programmatic use.
 */
export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliError';
  }
}
