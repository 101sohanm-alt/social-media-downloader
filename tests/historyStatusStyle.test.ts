/**
 * Guards the link between the DownloadHistoryItem status union and the popup's
 * stylesheet.
 *
 * The popup renders `class="status-${item.status}"` from raw data, so a status
 * with no matching CSS rule produces an unstyled chip with no error anywhere —
 * which is exactly how `pending` shipped: the type and the CSS disagreed and
 * nothing noticed. A DOM test would need a full popup harness to catch this, so
 * this asserts the invariant directly against the source of both files.
 *
 * If this fails after adding a status to the union: add the matching
 * `.status-<name>` rule to src/popup/popup.css.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

/** Pull the status literals out of the DownloadHistoryItem interface. */
function statusUnion(): string[] {
  const types = read('src/shared/types.ts');
  const match = types.match(/status:\s*([^;]+);/);
  if (!match) throw new Error('could not find the status field in types.ts');
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe('history status styling', () => {
  it('finds the status union', () => {
    const statuses = statusUnion();
    expect(statuses.length).toBeGreaterThan(0);
    // sanity: the three states the download path actually writes
    expect(statuses).toEqual(expect.arrayContaining(['completed', 'failed', 'pending']));
  });

  it('has a .status-<name> rule for every status the union allows', () => {
    const css = read('src/popup/popup.css');
    // Match the rule boundary, not a bare substring: `.status-pendingX` contains
    // `.status-pending`, so `css.includes()` reports a rule that does not exist.
    const hasRule = (s: string) => new RegExp(`\\.status-${s}\\s*\\{`).test(css);
    const missing = statusUnion().filter((s) => !hasRule(s));
    expect(missing, `no CSS rule for: ${missing.join(', ')}`).toEqual([]);
  });

  it('renders the status as a class in the popup', () => {
    // If the render template stops using status-${...}, the CSS link is moot.
    const popup = read('src/popup/popup.ts');
    expect(popup).toContain('status-${item.status}');
  });
});
