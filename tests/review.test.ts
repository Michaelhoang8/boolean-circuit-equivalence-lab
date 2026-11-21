import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BDD } from '../src/bdd.ts';

test('all three-variable functions and Boolean pair operations match bit-vector truth tables', () => {
  const order = ['a', 'b', 'c'];
  const manager = new BDD(order);
  const variables = order.map(name => manager.variable(name));
  // Bit index 4*a+2*b+c identifies each row; Shannon halves split on a,
  // then b, then c. This construction does not use the circuit compiler.
  const shannon = (mask: number, level: number): number => {
    if (level === 3) return mask & 1;
    const halfRows = 2 ** (2 - level);
    const low = mask & ((1 << halfRows) - 1);
    const high = mask >>> halfRows;
    return manager.mux(variables[level], shannon(low, level + 1), shannon(high, level + 1));
  };
  const roots = Array.from({ length: 256 }, (_, mask) => shannon(mask, 0));
  assert.equal(new Set(roots).size, 256);
  for (let mask = 0; mask < 256; mask++) {
    for (let row = 0; row < 8; row++) {
      assert.equal(manager.evaluate(roots[mask], { a: Boolean(row & 4), b: Boolean(row & 2), c: Boolean(row & 1) }), Boolean(mask & (1 << row)));
    }
    assert.equal(manager.not(roots[mask]), roots[(~mask) & 255]);
    const witness = manager.witness(roots[mask]);
    if (mask === 0) assert.equal(witness, null);
    else {
      const first = Array.from({ length: 8 }, (_, index) => index).find(row => mask & (1 << row))!;
      assert.deepEqual(witness, { a: Boolean(first & 4), b: Boolean(first & 2), c: Boolean(first & 1) });
    }
    for (let other = 0; other < 256; other++) {
      assert.equal(manager.apply('and', roots[mask], roots[other]), roots[mask & other]);
      assert.equal(manager.apply('or', roots[mask], roots[other]), roots[mask | other]);
      assert.equal(manager.apply('xor', roots[mask], roots[other]), roots[mask ^ other]);
    }
  }
});
