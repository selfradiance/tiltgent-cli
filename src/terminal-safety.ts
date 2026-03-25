const ANSI_ESCAPE_PATTERN = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(ANSI_ESCAPE_PATTERN, '')
    .replace(/[\u0000-\u0008\u000B-\u001A\u001C-\u001F\u007F-\u009F]/g, '')
    .replace(/\r/g, '');
}

export function sanitizeInlineText(text: string): string {
  return sanitizeTerminalText(text).replace(/\s+/g, ' ').trim();
}
