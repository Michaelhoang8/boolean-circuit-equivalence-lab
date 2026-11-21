import type { Circuit, Gate } from './circuit.ts';
import { validateCircuit } from './circuit.ts';
class Builder {
  gates: Gate[] = [];
  add(op: Gate['op'], ...args: string[]): string { const id = `g${this.gates.length}`; this.gates.push({ id, op, args }); return id; }
}
export function adder(width: number, implementation: 'ripple' | 'prefix' | 'faulty'): Circuit {
  if (!Number.isInteger(width) || width < 1 || width > 15) throw new Error('Adder width must be 1–15');
  const build = new Builder(); const inputs = ['cin', ...Array.from({ length: width }, (_, bit) => [`a${bit}`, `b${bit}`]).flat()];
  const p = Array.from({ length: width }, (_, bit) => build.add('xor', `a${bit}`, `b${bit}`));
  const g = Array.from({ length: width }, (_, bit) => build.add('and', `a${bit}`, `b${bit}`));
  const carry = ['cin'];
  if (implementation === 'prefix') {
    let groupsG = [...g], groupsP = [...p];
    // Parallel prefix rounds combine disjoint adjacent bit groups from the prior round.
    for (let distance = 1; distance < width; distance *= 2) {
      const nextG = [...groupsG], nextP = [...groupsP];
      for (let bit = distance; bit < width; bit++) {
        nextG[bit] = build.add('or', groupsG[bit], build.add('and', groupsP[bit], groupsG[bit - distance]));
        nextP[bit] = build.add('and', groupsP[bit], groupsP[bit - distance]);
      }
      groupsG = nextG; groupsP = nextP;
    }
    for (let bit = 0; bit < width; bit++) carry.push(build.add('or', groupsG[bit], build.add('and', groupsP[bit], 'cin')));
  } else {
    for (let bit = 0; bit < width; bit++) {
      const propagated = build.add('and', p[bit], carry[bit]);
      carry.push(build.add(implementation === 'faulty' && bit === Math.min(2, width - 1) ? 'and' : 'or', g[bit], propagated));
    }
  }
  const outputs = p.map((wire, bit) => ({ name: `s${bit}`, wire: build.add('xor', wire, carry[bit]) }));
  outputs.push({ name: 'cout', wire: carry[width] });
  return validateCircuit({ version: 1, name: `adder_${width}_${implementation}`, inputs, gates: build.gates, outputs });
}
export function multiplexer(selectBits: number, implementation: 'tree' | 'terms'): Circuit {
  if (!Number.isInteger(selectBits) || selectBits < 1 || selectBits > 4) throw new Error('Multiplexer selector width must be 1–4');
  const build = new Builder(); const selects = Array.from({ length: selectBits }, (_, bit) => `s${bit}`);
  const data = Array.from({ length: 2 ** selectBits }, (_, bit) => `d${bit}`); let root: string;
  if (implementation === 'tree') {
    let wires = [...data];
    for (const select of selects) wires = Array.from({ length: wires.length / 2 }, (_, i) => build.add('mux', select, wires[2 * i], wires[2 * i + 1]));
    root = wires[0];
  } else {
    const inverted = selects.map(select => build.add('not', select));
    const terms = data.map((wire, index) => {
      let term = wire;
      selects.forEach((select, bit) => { term = build.add('and', term, index & (2 ** bit) ? select : inverted[bit]); });
      return term;
    });
    root = terms.reduce((left, right) => build.add('or', left, right), '0');
  }
  return validateCircuit({ version: 1, name: `mux_${data.length}_${implementation}`, inputs: [...selects, ...data], gates: build.gates, outputs: [{ name: 'out', wire: root }] });
}
export type Experiment = { id: string; left: string; right: string; order: string[]; maxNodes: number; maxCacheEntries: number; oracle: boolean };
export function fixtures() {
  const circuits: Record<string, Circuit> = {}; const experiments: Experiment[] = [];
  const add = (circuit: Circuit) => { circuits[circuit.name] = circuit; return circuit.name; };
  for (const width of [2, 4, 8, 12]) {
    const left = add(adder(width, 'ripple')), right = add(adder(width, 'prefix'));
    const order = circuits[left].inputs;
    experiments.push({ id: `adder-${width}-interleaved`, left, right, order, maxNodes: 100_000, maxCacheEntries: 200_000, oracle: width <= 4 });
    if (width === 8) experiments.push({ id: 'adder-8-grouped', left, right, order: ['cin', ...Array.from({ length: width }, (_, i) => `a${i}`), ...Array.from({ length: width }, (_, i) => `b${i}`)], maxNodes: 100_000, maxCacheEntries: 200_000, oracle: false });
    if (width === 4) experiments.push({ id: 'adder-4-faulty', left, right: add(adder(width, 'faulty')), order, maxNodes: 100_000, maxCacheEntries: 200_000, oracle: true });
  }
  for (const selects of [1, 3]) {
    const left = add(multiplexer(selects, 'tree')), right = add(multiplexer(selects, 'terms'));
    const order = circuits[left].inputs;
    experiments.push({ id: `mux-${2 ** selects}-select-first`, left, right, order, maxNodes: 100_000, maxCacheEntries: 200_000, oracle: true });
    if (selects === 3) {
      const dataFirst = [...order.slice(selects), ...order.slice(0, selects)];
      experiments.push({ id: 'mux-8-data-first', left, right, order: dataFirst, maxNodes: 100_000, maxCacheEntries: 200_000, oracle: true });
      experiments.push({ id: 'mux-8-node-limit', left, right, order: dataFirst, maxNodes: 100, maxCacheEntries: 200_000, oracle: true });
      experiments.push({ id: 'mux-8-cache-limit', left, right, order, maxNodes: 100_000, maxCacheEntries: 0, oracle: true });
    }
  }
  return { circuits, experiments };
}
