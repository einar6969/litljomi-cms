import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Both paths come from this file's location, so the test always reads the repository's own files.
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const envExamplePath = join(root, '.env.example');
const runbookPath = join(root, 'docs', 'runbooks', 'production.md');

// The section's level-2 heading, with or without a section number ("## 13. Environment variables").
const RUNBOOK_SECTION_HEADING = /^## (?:\d+\. )?Environment variables$/;
const ENV_LINE = /^([A-Z][A-Z0-9_]*)=(.*)$/;
const BACKTICKED_NAME = /^`([A-Z][A-Z0-9_]*)`$/;
const RUNBOOK_TABLE = 'the "Environment variables" table in docs/runbooks/production.md';

/**
 * `NAME=value` lines of `.env.example`, in file order (duplicates kept).
 * Comments and blank lines are skipped.
 */
function readEnvExample(): [name: string, value: string][] {
  const entries: [string, string][] = [];
  for (const line of readFileSync(envExamplePath, 'utf8').split('\n')) {
    const match = ENV_LINE.exec(line.trim());
    if (match) entries.push([match[1]!, match[2]!]);
  }
  return entries;
}

/**
 * Names in the first column of the table rows in the runbook's environment-variable section
 * (from its heading to the next level-2 heading), in table order (duplicates kept).
 * Mentions elsewhere in the runbook do not count.
 */
function readRunbookNames(): string[] {
  const lines = readFileSync(runbookPath, 'utf8').split('\n');
  const start = lines.findIndex((line) => RUNBOOK_SECTION_HEADING.test(line.trim()));
  if (start === -1) throw new Error('runbook has no "Environment variables" section');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) continue;
    const firstCell = line.trim().split('|')[1]?.trim() ?? '';
    const match = BACKTICKED_NAME.exec(firstCell);
    if (match) names.push(match[1]!);
  }
  return names;
}

const envExampleNames = (): string[] => readEnvExample().map(([name]) => name);

const missingFrom = (names: Iterable<string>, other: Iterable<string>): string[] => {
  const present = new Set(other);
  return [...new Set(names)].filter((name) => !present.has(name)).sort();
};

const duplicatesIn = (names: string[]): string[] =>
  [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].sort();

describe('.env.example and the production runbook', () => {
  it('both name at least one variable', () => {
    expect(envExampleNames().length, '.env.example has no NAME= lines').toBeGreaterThan(0);
    expect(readRunbookNames().length, `${RUNBOOK_TABLE} names no variable`).toBeGreaterThan(0);
  });

  it('.env.example names each variable once', () => {
    const duplicates = duplicatesIn(envExampleNames());
    expect(duplicates, `named more than once in .env.example: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('the runbook table names each variable once', () => {
    const duplicates = duplicatesIn(readRunbookNames());
    expect(duplicates, `named more than once in ${RUNBOOK_TABLE}: ${duplicates.join(', ')}`).toEqual([]);
  });

  it('every .env.example variable is in the runbook table', () => {
    const missing = missingFrom(envExampleNames(), readRunbookNames());
    expect(missing, `missing from ${RUNBOOK_TABLE}: ${missing.join(', ')}`).toEqual([]);
  });

  it('every runbook variable is in .env.example', () => {
    const missing = missingFrom(readRunbookNames(), envExampleNames());
    expect(missing, `missing from .env.example: ${missing.join(', ')}`).toEqual([]);
  });

  it('.env.example holds no values', () => {
    const withValues = readEnvExample()
      .filter(([, value]) => value.trim() !== '')
      .map(([name]) => name);
    expect(withValues, `.env.example must leave these empty: ${withValues.join(', ')}`).toEqual([]);
  });
});
