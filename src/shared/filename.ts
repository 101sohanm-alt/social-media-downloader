/**
 * Sanitizes a filename string by replacing illegal characters across operating systems.
 */
export function sanitizeFilename(input: string): string {
  if (!input) return '';
  // Remove control characters (0-31 and 127)
  const withoutControl = input.replace(/[\x00-\x1f\x7f]/g, '');
  // Replace illegal chars: / \ : * ? " < > | with an underscore
  return withoutControl.replace(/[/\\:*?"<>|]/g, '_');
}

export interface FormatTokens {
  platform?: string;
  author?: string;
  id?: string;
  title?: string;
  index?: number;
  total?: number;
  date?: Date;
  ext?: string;
}

/**
 * Formats a filename based on a user template and metadata tokens.
 */
export function formatFilename(
  template: string,
  tokens: FormatTokens,
  maxBaseLength?: number
): string {
  const platform = tokens.platform ? sanitizeFilename(tokens.platform) : 'social';
  const author = tokens.author ? sanitizeFilename(tokens.author) : 'unknown';
  const id = tokens.id ? sanitizeFilename(tokens.id) : 'media';
  const title = tokens.title ? sanitizeFilename(tokens.title) : 'post';
  const dateStr = (tokens.date || new Date()).toISOString().slice(0, 10);
  const ext = tokens.ext ? (tokens.ext.startsWith('.') ? tokens.ext : `.${tokens.ext}`) : '.jpg';

  let base = template
    .replace(/{platform}/gi, platform)
    .replace(/{author}/gi, author)
    .replace(/{id}/gi, id)
    .replace(/{title}/gi, title)
    .replace(/{date}/gi, dateStr);

  if (tokens.index !== undefined) {
    base = base.replace(/{index}/gi, String(tokens.index));
  } else {
    base = base.replace(/[_-]?{index}/gi, '');
  }

  // Automatically append index when total > 1 and index was not in template
  if (tokens.total && tokens.total > 1 && tokens.index !== undefined && !template.includes('{index}')) {
    base = `${base}_${tokens.index}`;
  }

  if (maxBaseLength && maxBaseLength > 0) {
    base = base.slice(0, maxBaseLength);
  }

  return `${base}${ext}`;
}
