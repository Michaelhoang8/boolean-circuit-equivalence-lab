import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import assert from 'node:assert/strict';
import { parseCircuit } from '../src/circuit.ts';
import { compareCircuits, truthTable } from '../src/equivalence.ts';
import type { Experiment } from '../src/fixtures.ts';
const argv = process.argv.slice(2);
if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--output' || !/^results(?:-[a-z0-9-]+)?$/.test(argv[1]))) throw new Error('Usage: npm run measure -- [--output results-local]');
const output = argv[1] ?? 'results';
for (const folder of [output, `${output}/comparisons`, `${output}/truth-tables`]) mkdirSync(folder, { recursive: true });
const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const experiments = JSON.parse(read('data/experiments.json')) as Experiment[];
const sources = ['src/bdd.ts', 'src/circuit.ts', 'src/equivalence.ts', 'src/fixtures.ts', 'scripts/generate.ts', 'scripts/measure.ts'];
const inputs = new Set(['data/experiments.json']); const summaries = [];
const timings = ['experiment,repetition,status,elapsed_ms,allocated_nodes,cache_entries,apply_calls,cache_hits'];
const warmups = 2, repetitions = 9;
for (const experiment of experiments) {
  const leftPath = `data/circuits/${experiment.left}.json`, rightPath = `data/circuits/${experiment.right}.json`;
  inputs.add(leftPath); inputs.add(rightPath);
  const left = parseCircuit(read(leftPath)), right = parseCircuit(read(rightPath));
  const limits = { maxNodes: experiment.maxNodes, maxCacheEntries: experiment.maxCacheEntries };
  const run = () => compareCircuits(left, right, experiment.order, limits);
  for (let i = 0; i < warmups; i++) run();
  const samples = Array.from({ length: repetitions }, () => run()); const first = samples[0];
  const withoutTime = ({ elapsedMs: _, ...rest }: ReturnType<typeof run>) => rest;
  for (const [i, sample] of samples.entries()) {
    assert.deepEqual(withoutTime(sample), withoutTime(first));
    timings.push([experiment.id, i + 1, sample.status, sample.elapsedMs, sample.stats.allocatedNodes, sample.stats.cacheEntries, sample.stats.applyCalls, sample.stats.cacheHits].join(','));
  }
  const comparisonFile = `comparisons/${experiment.id}.json`;
  json(`${output}/${comparisonFile}`, first);
  let oracle: null | { assignments: number; mismatches: number; firstMismatch: unknown; file: string; sha256: string; inputOrder: string[]; outputOrder: string[] } = null;
  if (experiment.oracle) {
    const rows = truthTable(left, right, experiment.order), mismatches = rows.filter(row => row.differingOutputs.length > 0);
    if (first.status !== 'UNKNOWN') {
      assert.equal(first.status === 'EQUIVALENT', mismatches.length === 0);
      assert.deepEqual(first.witness, mismatches[0] ?? null);
    }
    const outputs = left.outputs.map(output => output.name).sort();
    const csv = ['input_bits,left_output_bits,right_output_bits,differing_outputs', ...rows.map(row => [experiment.order.map(name => Number(row.assignment[name])).join(''), outputs.map(name => Number(row.left[name])).join(''), outputs.map(name => Number(row.right[name])).join(''), row.differingOutputs.join('|')].join(','))].join('\n') + '\n';
    const file = `truth-tables/${experiment.id}.csv`; writeFileSync(`${output}/${file}`, csv);
    oracle = { assignments: rows.length, mismatches: mismatches.length, firstMismatch: mismatches[0] ?? null, file, sha256: hash(csv), inputOrder: experiment.order, outputOrder: outputs };
  }
  const times = samples.map(sample => sample.elapsedMs).sort((a, b) => a - b);
  summaries.push({ ...experiment, status: first.status, stats: first.stats, reachableNodes: first.status === 'UNKNOWN' ? null : first.reachableNodes.length, miter: first.status === 'UNKNOWN' ? null : first.miter, exhausted: first.status === 'UNKNOWN' ? first.exhausted : null, elapsedMs: { min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) }, comparisonFile, comparisonSha256: hash(read(`${output}/${comparisonFile}`)), oracle });
  console.log(`${experiment.id}: ${first.status}; allocated=${first.stats.allocatedNodes}; reachable=${first.status === 'UNKNOWN' ? 'unresolved' : first.reachableNodes.length}`);
}
writeFileSync(`${output}/timings.csv`, timings.join('\n') + '\n');
json(`${output}/summary.json`, { format: 1, warmups, repetitions, timingScope: 'Fresh manager: circuit compilation, miter and independent witness replay; excludes schema prevalidation, diagnostics traversal, truth-table enumeration, I/O and rendering.', experiments: summaries });
json(`${output}/environment.json`, { generatedAt: new Date().toISOString(), node: process.version, platform: platform(), architecture: arch(), cpuModel: cpus()[0]?.model ?? 'unavailable', logicalCpus: cpus().length, textHashNormalization: 'CRLF replaced with LF before SHA-256; UTF-8', inputSha256: Object.fromEntries([...inputs].sort().map(path => [path, hash(read(path))])), sourceSha256: Object.fromEntries(sources.map(path => [path, hash(read(path))])), provenance: 'AI-assisted implementation and owned synthetic circuit fixtures; actual local executions, not physical hardware measurements.' });
