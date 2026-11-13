// A12: the moves of a manually ordered type's list, as pure functions (spec §5.1).
import { describe, expect, it } from 'vitest';
import { applyMove, dropPlace, isNoMove, stepMove } from '../entry-order';

const ids = ['a', 'b', 'c', 'd'];

describe('applyMove', () => {
  it('puts the entry just before or just after the target', () => {
    expect(applyMove(ids, { entryId: 'd', targetId: 'a', place: 'before' })).toEqual(['d', 'a', 'b', 'c']);
    expect(applyMove(ids, { entryId: 'a', targetId: 'd', place: 'after' })).toEqual(['b', 'c', 'd', 'a']);
    expect(applyMove(ids, { entryId: 'a', targetId: 'c', place: 'before' })).toEqual(['b', 'a', 'c', 'd']);
    expect(applyMove(ids, { entryId: 'd', targetId: 'b', place: 'after' })).toEqual(['a', 'b', 'd', 'c']);
  });

  it('changes nothing for the entry itself or an id the list does not have, and never the input', () => {
    expect(applyMove(ids, { entryId: 'b', targetId: 'b', place: 'before' })).toEqual(ids);
    expect(applyMove(ids, { entryId: 'x', targetId: 'b', place: 'before' })).toEqual(ids);
    expect(applyMove(ids, { entryId: 'b', targetId: 'x', place: 'after' })).toEqual(ids);
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('stepMove', () => {
  it('one place up is before the entry above; one place down is after the entry below', () => {
    expect(stepMove(ids, 2, -1)).toEqual({ entryId: 'c', targetId: 'b', place: 'before' });
    expect(stepMove(ids, 1, 1)).toEqual({ entryId: 'b', targetId: 'c', place: 'after' });
    expect(applyMove(ids, stepMove(ids, 2, -1)!)).toEqual(['a', 'c', 'b', 'd']);
    expect(applyMove(ids, stepMove(ids, 1, 1)!)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('is null at the ends and outside the list', () => {
    expect(stepMove(ids, 0, -1)).toBeNull();
    expect(stepMove(ids, 3, 1)).toBeNull();
    expect(stepMove(ids, 7, -1)).toBeNull();
    expect(stepMove([], 0, 1)).toBeNull();
  });
});

describe('dropPlace and isNoMove', () => {
  it('drops before a row in its upper half and after it in its lower half', () => {
    expect(dropPlace(100, 60, 100)).toBe('before');
    expect(dropPlace(100, 60, 129)).toBe('before');
    expect(dropPlace(100, 60, 130)).toBe('after');
    expect(dropPlace(100, 60, 159)).toBe('after');
  });

  it('knows a drop that leaves the list as it is', () => {
    expect(isNoMove(ids, { entryId: 'b', targetId: 'a', place: 'after' })).toBe(true);
    expect(isNoMove(ids, { entryId: 'b', targetId: 'c', place: 'before' })).toBe(true);
    expect(isNoMove(ids, { entryId: 'b', targetId: 'b', place: 'before' })).toBe(true);
    expect(isNoMove(ids, { entryId: 'b', targetId: 'c', place: 'after' })).toBe(false);
  });
});
