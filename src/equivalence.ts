import { BDD, BudgetExceeded, DEFAULT_LIMITS } from './bdd.ts';
import type { Limits, Node } from './bdd.ts';
import { compile, evaluateCircuit, validateCircuit } from './circuit.ts';
import type { Circuit } from './circuit.ts';
export type Diagnostic = { order: string[]; limits: Limits; stats: ReturnType<typeof statsOf>; elapsedMs: number };
function statsOf(manager: BDD) { return manager.stats; }
export type Comparison = Diagnostic & (
  { status: 'UNKNOWN'; exhausted: 'nodes' | 'cache'; stage: string }
  | { status: 'EQUIVALENT' | 'INEQUIVALENT'; miter: number; left: Record<string, number>; right: Record<string, number>; differences: Record<string, number>; reachableNodes: Node[]; witness: null | { assignment: Record<string, boolean>; left: Record<string, boolean>; right: Record<string, boolean>; differingOutputs: string[] } }
);
export function compareCircuits(leftInput: Circuit, rightInput: Circuit, order: string[], limits: Limits = DEFAULT_LIMITS): Comparison {
  const left = validateCircuit(leftInput), right = validateCircuit(rightInput);
  if ([...left.inputs].sort().join('|') !== [...right.inputs].sort().join('|')) throw new Error('Circuits must have identical named input sets');
  const names = left.outputs.map(output => output.name).sort();
  if (names.join('|') !== right.outputs.map(output => output.name).sort().join('|')) throw new Error('Circuits must have identical named output sets');
  if ([...order].sort().join('|') !== [...left.inputs].sort().join('|')) throw new Error('Order must be an exact input permutation');
  const manager = new BDD(order, limits); let stage = 'left circuit'; const start = performance.now();
  const diagnostic = (): Diagnostic => ({ order: manager.order, limits: manager.limits, stats: manager.stats, elapsedMs: performance.now() - start });
  try {
    const a = compile(left, manager); stage = 'right circuit'; const b = compile(right, manager); stage = 'miter';
    const differences: Record<string, number> = {}; let miter = 0;
    for (const name of names) { differences[name] = manager.apply('xor', a[name], b[name]); miter = manager.apply('or', miter, differences[name]); }
    const assignment = manager.witness(miter); let witness = null;
    if (assignment) {
      const leftValues = evaluateCircuit(left, assignment), rightValues = evaluateCircuit(right, assignment);
      const differingOutputs = names.filter(name => leftValues[name] !== rightValues[name]);
      if (differingOutputs.length === 0 || !manager.evaluate(miter, assignment)) throw new Error('Counterexample failed independent gate replay');
      witness = { assignment, left: leftValues, right: rightValues, differingOutputs };
    }
    return { ...diagnostic(), status: miter === 0 ? 'EQUIVALENT' : 'INEQUIVALENT', miter, left: a, right: b, differences, reachableNodes: manager.reachable([...Object.values(a), ...Object.values(b), miter, ...Object.values(differences)]), witness };
  } catch (error) {
    if (error instanceof BudgetExceeded) return { ...diagnostic(), status: 'UNKNOWN', exhausted: error.resource, stage };
    throw error;
  }
}
export function truthTable(left: Circuit, right: Circuit, order: string[]) {
  validateCircuit(left); validateCircuit(right);
  if (order.length > 12) throw new Error('Truth-table oracle is limited to 12 inputs');
  if (new Set(order).size !== order.length || [...order].sort().join('|') !== [...left.inputs].sort().join('|') || [...order].sort().join('|') !== [...right.inputs].sort().join('|')) throw new Error('Invalid truth-table order');
  const names = left.outputs.map(output => output.name).sort();
  if (names.join('|') !== right.outputs.map(output => output.name).sort().join('|')) throw new Error('Output names differ');
  const rows = [];
  for (let index = 0; index < 2 ** order.length; index++) {
    const assignment = Object.fromEntries(order.map((name, bit) => [name, Boolean(index & (2 ** (order.length - bit - 1)))]));
    const a = evaluateCircuit(left, assignment), b = evaluateCircuit(right, assignment);
    rows.push({ assignment, left: a, right: b, differingOutputs: names.filter(name => a[name] !== b[name]) });
  }
  return rows;
}
