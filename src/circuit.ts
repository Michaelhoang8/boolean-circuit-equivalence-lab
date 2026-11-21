import { BDD } from './bdd.ts';
export type Gate = { id: string; op: 'not' | 'and' | 'or' | 'xor' | 'mux'; args: string[] };
export type Circuit = { version: 1; name: string; inputs: string[]; gates: Gate[]; outputs: Array<{ name: string; wire: string }> };
const ID = /^[a-z][a-z0-9_]{0,31}$/;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error(`Expected fields: ${keys.join(', ')}`);
  return value as Record<string, unknown>;
}
function identifier(value: unknown): string { if (typeof value !== 'string' || !ID.test(value)) throw new Error('Invalid circuit identifier'); return value; }
export function parseCircuit(text: string): Circuit {
  if (Buffer.byteLength(text) > 262_144) throw new Error('Circuit exceeds 262144-byte limit');
  const parsed: unknown = JSON.parse(text);
  let compact = '', inside = false, escaped = false;
  for (const char of text) {
    if (inside) { compact += char; if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') inside = false; }
    else if (char === '"') { inside = true; compact += char; } else if (!' \n\r\t'.includes(char)) compact += char;
  }
  if (JSON.stringify(parsed) !== compact) throw new Error('JSON tokens must use canonical spelling without duplicate keys');
  return validateCircuit(parsed);
}
export function validateCircuit(input: unknown): Circuit {
  const obj = object(input, ['version', 'name', 'inputs', 'gates', 'outputs']);
  if (obj.version !== 1) throw new Error('Unsupported circuit version');
  const name = identifier(obj.name);
  if (!Array.isArray(obj.inputs) || obj.inputs.length < 1 || obj.inputs.length > 32) throw new Error('Expected 1–32 inputs');
  const inputs = obj.inputs.map(identifier); const wires = new Set(['0', '1', ...inputs]);
  if (wires.size !== inputs.length + 2) throw new Error('Duplicate inputs');
  if (!Array.isArray(obj.gates) || obj.gates.length > 512) throw new Error('Expected at most 512 gates');
  const gates: Gate[] = obj.gates.map(value => {
    const gate = object(value, ['id', 'op', 'args']); const id = identifier(gate.id);
    if (wires.has(id)) throw new Error('Duplicate gate or input identifier');
    if (typeof gate.op !== 'string' || !['not', 'and', 'or', 'xor', 'mux'].includes(gate.op)) throw new Error('Unknown gate operation');
    const arity = gate.op === 'not' ? 1 : gate.op === 'mux' ? 3 : 2;
    if (!Array.isArray(gate.args) || gate.args.length !== arity || gate.args.some(wire => typeof wire !== 'string' || !wires.has(wire))) throw new Error('Gate arguments must reference constants, inputs or earlier gates with exact arity');
    wires.add(id); return { id, op: gate.op as Gate['op'], args: [...gate.args] as string[] };
  });
  if (!Array.isArray(obj.outputs) || obj.outputs.length < 1 || obj.outputs.length > 33) throw new Error('Expected 1–33 outputs');
  const names = new Set<string>(); const outputs = obj.outputs.map(value => {
    const out = object(value, ['name', 'wire']); const name = identifier(out.name);
    if (names.has(name) || typeof out.wire !== 'string' || !wires.has(out.wire)) throw new Error('Invalid or duplicate output');
    names.add(name); return { name, wire: out.wire };
  });
  return { version: 1, name, inputs, gates, outputs };
}
export function compile(circuit: Circuit, manager: BDD): Record<string, number> {
  const valid = validateCircuit(circuit);
  if ([...manager.order].sort().join('|') !== [...valid.inputs].sort().join('|')) throw new Error('Variable order must be an exact input permutation');
  const wires = new Map<string, number>([['0', 0], ['1', 1]]);
  valid.inputs.forEach(name => wires.set(name, manager.variable(name)));
  for (const gate of valid.gates) {
    const args = gate.args.map(name => wires.get(name)!);
    const root = gate.op === 'not' ? manager.not(args[0]) : gate.op === 'mux' ? manager.mux(args[0], args[1], args[2]) : manager.apply(gate.op, args[0], args[1]);
    wires.set(gate.id, root);
  }
  return Object.fromEntries(valid.outputs.map(output => [output.name, wires.get(output.wire)!]));
}

/** Straight-line Boolean oracle: no BDD operations, caches or Boolean rewrites. */
export function evaluateCircuit(circuit: Circuit, assignment: Record<string, boolean>): Record<string, boolean> {
  const valid = validateCircuit(circuit);
  if (!assignment || typeof assignment !== 'object' || Object.keys(assignment).length !== valid.inputs.length || valid.inputs.some(name => !Object.hasOwn(assignment, name) || typeof assignment[name] !== 'boolean')) throw new Error('Assignment must contain exactly the Boolean circuit inputs');
  const wires: Record<string, boolean> = { '0': false, '1': true, ...assignment };
  for (const gate of valid.gates) {
    const values = gate.args.map(wire => wires[wire]); let result: boolean;
    switch (gate.op) {
      case 'not': result = !values[0]; break;
      case 'and': result = values[0] && values[1]; break;
      case 'or': result = values[0] || values[1]; break;
      case 'xor': result = values[0] !== values[1]; break;
      case 'mux': result = values[0] ? values[2] : values[1]; break;
    }
    wires[gate.id] = result;
  }
  return Object.fromEntries(valid.outputs.map(output => [output.name, wires[output.wire]]));
}
