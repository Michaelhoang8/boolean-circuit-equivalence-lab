import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BDD, BudgetExceeded } from '../src/bdd.ts';
import { parseCircuit, validateCircuit, compile, evaluateCircuit } from '../src/circuit.ts';
import type { Circuit, Gate } from '../src/circuit.ts';
import { compareCircuits, truthTable } from '../src/equivalence.ts';
import { adder, multiplexer } from '../src/fixtures.ts';

test('all supported gate truth tables match explicit Boolean semantics', () => {
  const manager = new BDD(['a', 'b', 'c']); const [a, b, c] = manager.order.map(name => manager.variable(name));
  const roots = { not: manager.not(a), and: manager.apply('and', a, b), or: manager.apply('or', a, b), xor: manager.apply('xor', a, b), mux: manager.mux(a, b, c) };
  for (let bits = 0; bits < 8; bits++) {
    const assignment = { a: Boolean(bits & 4), b: Boolean(bits & 2), c: Boolean(bits & 1) };
    const expected = { not: !assignment.a, and: assignment.a && assignment.b, or: assignment.a || assignment.b, xor: assignment.a !== assignment.b, mux: assignment.a ? assignment.c : assignment.b };
    for (const op of Object.keys(roots) as Gate['op'][]) {
      const args = op === 'not' ? ['a'] : op === 'mux' ? ['a', 'b', 'c'] : ['a', 'b'];
      const circuit: Circuit = { version: 1, name: 'gate', inputs: ['a', 'b', 'c'], gates: [{ id: 'g', op, args }], outputs: [{ name: 'out', wire: 'g' }] };
      assert.equal(manager.evaluate(roots[op], assignment), expected[op]);
      assert.equal(evaluateCircuit(circuit, assignment).out, expected[op]);
    }
  }
});
test('reduction, unique table, computed cache and fixed-order canonical roots', () => {
  const manager = new BDD(['a', 'b', 'c']); const [a, b, c] = manager.order.map(name => manager.variable(name));
  assert.equal(manager.variable('a'), a); assert.equal(manager.apply('xor', a, a), 0); assert.equal(manager.apply('or', a, manager.not(a)), 1);
  const expanded = manager.apply('or', manager.apply('and', a, b), manager.apply('and', a, c));
  const factored = manager.apply('and', a, manager.apply('or', b, c)); assert.equal(expanded, factored);
  const before = manager.stats; assert.equal(manager.apply('and', a, manager.apply('or', b, c)), expanded); assert.ok(manager.stats.cacheHits > before.cacheHits);
  for (const node of manager.reachable([expanded])) {
    assert.notEqual(node.low, node.high);
    for (const child of [node.low, node.high]) if (child > 1) assert.ok(manager.node(child)!.level > node.level);
  }
});
test('small adders exhaustively match integer addition and both constructions', () => {
  for (const width of [1, 2, 3, 4]) {
    const left = adder(width, 'ripple'), right = adder(width, 'prefix');
    const comparison = compareCircuits(left, right, left.inputs); assert.equal(comparison.status, 'EQUIVALENT');
    for (const row of truthTable(left, right, left.inputs)) {
      let a = 0, b = 0, sum = 0;
      for (let bit = 0; bit < width; bit++) { a += Number(row.assignment[`a${bit}`]) * 2 ** bit; b += Number(row.assignment[`b${bit}`]) * 2 ** bit; sum += Number(row.left[`s${bit}`]) * 2 ** bit; }
      sum += Number(row.left.cout) * 2 ** width;
      assert.equal(sum, a + b + Number(row.assignment.cin)); assert.deepEqual(row.left, row.right);
    }
  }
});
test('faulty carry yields the first full assignment in fixed-order false-first enumeration', () => {
  const left = adder(4, 'ripple'), right = adder(4, 'faulty'); const comparison = compareCircuits(left, right, left.inputs);
  assert.equal(comparison.status, 'INEQUIVALENT');
  const first = truthTable(left, right, left.inputs).find(row => row.differingOutputs.length > 0)!;
  assert.deepEqual(comparison.witness, first); assert.notEqual(comparison.miter, 0);
});
test('multiplexers match direct indexed data selection under both orders', () => {
  for (const bits of [1, 2, 3]) {
    const left = multiplexer(bits, 'tree'), right = multiplexer(bits, 'terms');
    for (const order of [left.inputs, [...left.inputs].reverse()]) assert.equal(compareCircuits(left, right, order).status, 'EQUIVALENT');
    for (const row of truthTable(left, right, left.inputs)) {
      const index = Array.from({ length: bits }, (_, bit) => Number(row.assignment[`s${bit}`]) * 2 ** bit).reduce((a, b) => a + b, 0);
      assert.equal(row.left.out, row.assignment[`d${index}`]); assert.deepEqual(row.left, row.right);
    }
  }
});
test('node/cache exhaustion is UNKNOWN for both equivalent and inequivalent circuits', () => {
  const left = adder(4, 'ripple');
  for (const right of [adder(4, 'prefix'), adder(4, 'faulty')]) {
    for (const limits of [{ maxNodes: 0, maxCacheEntries: 100 }, { maxNodes: 100, maxCacheEntries: 0 }]) {
      const result = compareCircuits(left, right, left.inputs, limits); assert.equal(result.status, 'UNKNOWN');
      assert.equal(Object.hasOwn(result, 'witness'), false); assert.equal(Object.hasOwn(result, 'miter'), false);
    }
  }
  const manager = new BDD(['a'], { maxNodes: 1, maxCacheEntries: 0 }); assert.equal(manager.variable('a'), 2); assert.equal(manager.variable('a'), 2);
  assert.throws(() => manager.not(2), BudgetExceeded);
});
test('manager configuration and node diagnostics cannot mutate internal state', () => {
  const order = ['a', 'b']; const limits = { maxNodes: 20, maxCacheEntries: 20 }; const manager = new BDD(order, limits);
  order.reverse(); limits.maxNodes = 0; manager.order.reverse(); manager.limits.maxNodes = 0;
  const a = manager.variable('a'); manager.node(a)!.high = 0;
  assert.deepEqual(manager.order, ['a', 'b']); assert.equal(manager.limits.maxNodes, 20); assert.equal(manager.evaluate(a, { a: true, b: false }), true);
  assert.throws(() => manager.apply('unknown' as 'and', 0, 1)); assert.throws(() => manager.apply('and', 100, 1)); assert.throws(() => manager.evaluate(a, { a: true }));
});
test('parser rejects duplicate keys, invalid shape, forward references/cycles and wrong arity', () => {
  const good = adder(2, 'ripple'); assert.deepEqual(parseCircuit(JSON.stringify(good)), good);
  assert.throws(() => parseCircuit('{"version":1,"version":1}'));
  assert.throws(() => validateCircuit({ ...good, extra: 1 }));
  assert.throws(() => validateCircuit({ ...good, inputs: ['a', 'a'] }));
  assert.throws(() => validateCircuit({ ...good, gates: [{ id: 'g', op: 'and', args: ['g', 'cin'] }] }));
  assert.throws(() => validateCircuit({ ...good, gates: [{ id: 'g', op: 'not', args: ['cin', 'cin'] }] }));
  assert.throws(() => compile(good, new BDD(['z'])));
  assert.throws(() => compareCircuits(good, { ...good, outputs: [{ name: 'different', wire: 'cin' }] }, good.inputs));
  assert.throws(() => truthTable(adder(8, 'ripple'), adder(8, 'prefix'), adder(8, 'ripple').inputs));
});
