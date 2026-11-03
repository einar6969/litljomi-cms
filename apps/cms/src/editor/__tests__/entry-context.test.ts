import { describe, expect, it } from 'vitest';
import { authOrError, failureAmong, failureOf } from '../server/entry-context';

const p0001 = (message: string) => ({ error: { code: 'P0001', message } });

describe('failureOf', () => {
  it('passes the P0001 messages the editor has its own text for, and nothing else of a message', () => {
    expect(failureOf(p0001('version_conflict'))).toBe('version_conflict');
    expect(failureOf(p0001('slug_taken'))).toBe('slug_taken');
    expect(failureOf(p0001('slug_locked'))).toBe('slug_locked');
    expect(failureOf(p0001('not_found'))).toBe('error');
  });

  it('maps an expired or missing session to auth, every other error to the generic one', () => {
    expect(failureOf({ error: { code: 'PGRST301' } })).toBe('auth');
    expect(failureOf({ error: {}, status: 401 })).toBe('auth');
    expect(failureOf({ error: { code: '23505', message: 'duplicate key value violates unique constraint "x"' } })).toBe('error');
  });
});

// Task 24 quality r1: one mapper narrows failureOf to the codes an action may return, instead of a
// ternary per action.
describe('failureAmong', () => {
  it('keeps a failure the action has its own code for, and auth', () => {
    expect(failureAmong(p0001('version_conflict'), ['version_conflict'])).toBe('version_conflict');
    expect(failureAmong({ error: { code: 'PGRST303' } }, ['version_conflict'])).toBe('auth');
  });

  it('turns every failure outside the list into the generic error', () => {
    expect(failureAmong(p0001('slug_taken'), ['version_conflict'])).toBe('error');
    expect(failureAmong(p0001('version_conflict'), [])).toBe('error');
    expect(failureAmong({ error: { code: '42501', message: 'permission denied' } }, ['slug_taken', 'slug_locked'])).toBe('error');
  });

  it('authOrError is failureAmong with no own codes', () => {
    for (const result of [p0001('version_conflict'), p0001('slug_taken'), { error: { code: 'PGRST301' } }, { error: {}, status: 500 }]) {
      expect(authOrError(result)).toBe(failureAmong(result, []));
    }
  });
});
