import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Both paths come from this file's location, so the test always reads the repository's own files.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envExamplePath = join(root, '.env.example');
const runbookPath = join(root, 'docs', 'runbooks', 'staging.md');

// The section's level-2 heading, with or without a section number ("## 13. Environment variables").
const RUNBOOK_SECTION_HEADING = /^## (?:\d+\. )?Environment variables$/;
const ENV_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const BACKTICKED_NAME = /^`([A-Z][A-Z0-9_]*)`$/;

/** `NAME=value` lines of `.env.example`; comments and blank lines are skipped. */
function readEnvExample(): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of readFileSync(envExamplePath, 'utf8').split('\n')) {
    const match = ENV_LINE.exec(line.trim());
    if (match) entries.set(match[1]!, match[2]!);
  }
  return entries;
}

/**
 * Names in the first column of the table rows in the runbook's environment-variable section
 * (from its heading to the next level-2 heading). Mentions elsewhere in the runbook do not count.
 */
function readRunbookNames(): Set<string> {
  const lines = readFileSync(runbookPath, 'utf8').split('\n');
  const start = lines.findIndex((line) => RUNBOOK_SECTION_HEADING.test(line.trim()));
  if (start === -1) throw new Error('runbook has no "Environment variables" section');
  const names = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) continue;
    const firstCell = line.trim().split('|')[1]?.trim() ?? '';
    const match = BACKTICKED_NAME.exec(firstCell);
    if (match) names.add(match[1]!);
  }
  return names;
}

const missingFrom = (names: Iterable<string>, other: Set<string>): string[] =>
  [...names].filter((name) => !other.has(name)).sort();

describe('.env.example and the staging runbook', () => {
  it('both name at least one variable', () => {
    expect(readEnvExample().size).toBeGreaterThan(0);
    expect(readRunbookNames().size).toBeGreaterThan(0);
  });

  it('every .env.example variable is in the runbook table', () => {
    const missing = missingFrom(readEnvExample().keys(), readRunbookNames());
    expect(missing, `missing from the "Environment variables" table in docs/runbooks/staging.md: ${missing.join(', ')}`).toEqual([]);
  });

  it('every runbook variable is in .env.example', () => {
    const missing = missingFrom(readRunbookNames(), new Set(readEnvExample().keys()));
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('.env.example holds no values', () => {
    const withValues = [...readEnvExample()].filter(([, value]) => value.trim() !== '').map(([name]) => name);
    expect(withValues, `.env.example must leave these empty: ${withValues.join(', ')}`).toEqual([]);
  });
});
