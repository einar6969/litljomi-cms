// The import's manual order (docs/plans/import.md section 2.3, step 5; A12, spec §5.1): which moves
// put a type's entries in the manifest's order through api.move_entry, that a list already in order
// needs none, that entries outside the manifest are never moved, and the order check of the report.
import { describe, expect, it } from 'vitest';
import { applyMoves, orderDifference, planMoves, relativeOrder } from '../import/order.ts';

const letters = (s: string) => s.split('');

describe('planMoves', () => {
  it('needs no move when the list is already in the wanted order (a re-run moves nothing)', () => {
    expect(planMoves(letters('abcde'), letters('abcde'))).toEqual([]);
    // Entries outside the manifest between them change nothing: only the relative order counts.
    expect(planMoves(letters('axbycz'), letters('abc'))).toEqual([]);
  });

  it('puts a reversed list in order with one move fewer than it has entries', () => {
    // A new tenant's entries are listed newest first: the reverse of the order they were created in.
    const current = letters('edcba');
    const moves = planMoves(current, letters('abcde'));
    expect(moves).toHaveLength(4);
    expect(relativeOrder(applyMoves(current, moves), letters('abcde'))).toEqual(letters('abcde'));
  });

  it('moves only what is out of place, each relative to an entry already in place', () => {
    const moves = planMoves(letters('abdce'), letters('abcde'));
    expect(moves).toHaveLength(1);
    expect(relativeOrder(applyMoves(letters('abdce'), moves), letters('abcde'))).toEqual(letters('abcde'));
  });

  it('moves the first wanted entry before the first one in place', () => {
    const moves = planMoves(letters('bca'), letters('abc'));
    expect(moves).toEqual([{ entry: 'a', target: 'b', place: 'before' }]);
  });

  it('never moves an entry the manifest does not name, and never uses one as a target', () => {
    const current = letters('xcyazb');
    const moves = planMoves(current, letters('abc'));
    for (const m of moves) {
      expect('abc').toContain(m.entry);
      expect('abc').toContain(m.target);
    }
    const after = applyMoves(current, moves);
    expect(relativeOrder(after, letters('abc'))).toEqual(letters('abc'));
    // The others keep their order among themselves.
    expect(after.filter((x) => 'xyz'.includes(x))).toEqual(letters('xyz'));
    // And applying the plan again finds nothing to do.
    expect(planMoves(after, letters('abc'))).toEqual([]);
  });

  it('ends in the wanted order for every arrangement of five entries', () => {
    const wanted = letters('abcde');
    const permutations = (xs: string[]): string[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p])));
    for (const current of permutations(wanted)) {
      const moves = planMoves(current, wanted);
      const after = applyMoves(current, moves);
      expect(after, current.join('')).toEqual(wanted);
      expect(planMoves(after, wanted)).toEqual([]);
      // Never more moves than entries out of the longest run already in order.
      expect(moves.length).toBeLessThanOrEqual(wanted.length - 1);
    }
  });

  it('refuses a wanted entry that is not in the list', () => {
    expect(() => planMoves(letters('ab'), letters('abc'))).toThrow(/not in the list/);
  });
});

describe('orderDifference', () => {
  it('is null when the delivered order is the wanted one, whatever else is delivered', () => {
    expect(orderDifference(letters('abc'), letters('xaybzc'))).toBeNull();
  });

  it('judges only the wanted entries that are delivered (a missing one is reported elsewhere)', () => {
    expect(orderDifference(letters('abc'), letters('ac'))).toBeNull();
  });

  it('names the first place where the delivered order differs', () => {
    expect(orderDifference(letters('abcd'), letters('dcba'))).toEqual({ place: 1, expected: letters('abcd'), actual: letters('dcba') });
    expect(orderDifference(letters('abcd'), letters('abdc'))).toEqual({ place: 3, expected: letters('cd'), actual: letters('dc') });
  });
});
