import { readFileSync, statSync } from 'node:fs';
import { parseCircuit, evaluateCircuit } from '../src/circuit.ts';
import { compareCircuits } from '../src/equivalence.ts';
import { DEFAULT_LIMITS } from '../src/bdd.ts';
const usage = `Usage:
  npm run cli -- compare <left.json> <right.json> [--order a,b,c] [--max-nodes N] [--max-cache N]
  npm run cli -- replay <left.json> <right.json> <comparison.json>
Defaults: left circuit input order; 100000 nonterminal nodes; 200000 cache entries.
Exit 0: equivalent or successful replay; 1: inequivalent; 2: invalid input/error; 3: UNKNOWN.`;
const read = (file: string, max: number) => { if (statSync(file).size > max) throw new Error('Input file exceeds byte limit'); return readFileSync(file, 'utf8'); };
function main(): void {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--help' || command === '-h') { console.log(usage); return; }
  try {
    if (command === 'compare') {
      if (args.length < 2 || (args.length - 2) % 2 !== 0) throw new Error('Invalid arguments; use --help');
      const left = parseCircuit(read(args[0], 262_144)), right = parseCircuit(read(args[1], 262_144));
      let order = left.inputs; const limits = { ...DEFAULT_LIMITS }; const seen = new Set<string>();
      for (let index = 2; index < args.length; index += 2) {
        const flag = args[index], value = args[index + 1]; if (seen.has(flag)) throw new Error('Repeated option'); seen.add(flag);
        if (flag === '--order') order = value.split(',');
        else if (flag === '--max-nodes' || flag === '--max-cache') {
          if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Budget must be a nonnegative integer');
          limits[flag === '--max-nodes' ? 'maxNodes' : 'maxCacheEntries'] = Number(value);
        } else throw new Error('Unknown option');
      }
      const result = compareCircuits(left, right, order, limits); console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'UNKNOWN' ? 3 : result.status === 'INEQUIVALENT' ? 1 : 0;
    } else if (command === 'replay' && args.length === 3) {
      const left = parseCircuit(read(args[0], 262_144)), right = parseCircuit(read(args[1], 262_144));
      const saved: unknown = JSON.parse(read(args[2], 8_388_608));
      if (!saved || typeof saved !== 'object' || !('status' in saved) || saved.status !== 'INEQUIVALENT' || !('witness' in saved) || !saved.witness || typeof saved.witness !== 'object' || !('assignment' in saved.witness)) throw new Error('Replay requires an INEQUIVALENT result with a full assignment');
      const assignment = saved.witness.assignment as Record<string, boolean>;
      const a = evaluateCircuit(left, assignment), b = evaluateCircuit(right, assignment);
      const names = Object.keys(a).sort(); if (names.join('|') !== Object.keys(b).sort().join('|')) throw new Error('Circuit output names differ');
      const differingOutputs = names.filter(name => a[name] !== b[name]);
      if (differingOutputs.length === 0) throw new Error('Saved assignment does not distinguish these circuits');
      console.log(JSON.stringify({ replayed: true, assignment, left: a, right: b, differingOutputs }, null, 2));
    } else throw new Error('Invalid command or arguments; use --help');
  } catch (error) { console.error(`Error: ${error instanceof Error ? error.message : 'unknown failure'}`); process.exitCode = 2; }
}
main();
