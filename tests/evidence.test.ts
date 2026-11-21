import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseCircuit } from '../src/circuit.ts';
import { compareCircuits, truthTable } from '../src/equivalence.ts';
import type { Comparison } from '../src/equivalence.ts';
import type { Experiment } from '../src/fixtures.ts';
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const json = <T>(file: string) => JSON.parse(read(file)) as T;
const hash = (file: string) => createHash('sha256').update(read(file)).digest('hex');
type Oracle = { assignments: number; mismatches: number; firstMismatch: unknown; file: string; sha256: string; inputOrder: string[]; outputOrder: string[] };
type Row = Omit<Experiment, 'oracle'> & { oracle: Oracle | null; status: string; stats: Comparison['stats']; reachableNodes: number | null; miter: number | null; exhausted: string | null; elapsedMs: { min: number; median: number; max: number }; comparisonFile: string; comparisonSha256: string };
const summary = json<{ repetitions: number; warmups: number; experiments: Row[] }>('results/summary.json');
test('recorded input/source hashes and separately generated report/figure hashes match LF-normalized files', () => {
  const environment = json<{ inputSha256: Record<string, string>; sourceSha256: Record<string, string> }>('results/environment.json');
  for (const [file, sha] of Object.entries({ ...environment.inputSha256, ...environment.sourceSha256 })) assert.equal(hash(file), sha, file);
  const manifest = json<{ rendererSha256: string; measuredSummarySha256: string; files: Record<string, string> }>('docs/figures/manifest.json');
  assert.equal(hash('scripts/report.ts'), manifest.rendererSha256); assert.equal(hash('results/summary.json'), manifest.measuredSummarySha256);
  for (const [file, sha] of Object.entries(manifest.files)) assert.equal(hash(file), sha, file);
});
test('all recorded proof diagnostics reproduce; ordered/reduced graph snapshots evaluate independently', () => {
  const experiments = json<Experiment[]>('data/experiments.json');
  assert.equal(summary.experiments.length, experiments.length);
  for (const experiment of experiments) {
    const row = summary.experiments.find(row => row.id === experiment.id)!; assert.ok(row);
    const left = parseCircuit(read(`data/circuits/${experiment.left}.json`)), right = parseCircuit(read(`data/circuits/${experiment.right}.json`));
    const recorded = json<Comparison>(`results/${row.comparisonFile}`);
    assert.equal(hash(`results/${row.comparisonFile}`), row.comparisonSha256);
    const fresh = compareCircuits(left, right, experiment.order, { maxNodes: experiment.maxNodes, maxCacheEntries: experiment.maxCacheEntries });
    const omitTime = ({ elapsedMs: _, ...rest }: Comparison) => rest;
    assert.deepEqual(omitTime(recorded), omitTime(fresh)); assert.equal(recorded.status, row.status); assert.deepEqual(recorded.stats, row.stats);
    assert.equal(row.miter, recorded.status === 'UNKNOWN' ? null : recorded.miter);
    assert.equal(row.exhausted, recorded.status === 'UNKNOWN' ? recorded.exhausted : null);
    assert.equal(row.reachableNodes, recorded.status === 'UNKNOWN' ? null : recorded.reachableNodes.length);
    if (recorded.status === 'UNKNOWN') { assert.equal(Object.hasOwn(recorded, 'miter'), false); assert.equal(Object.hasOwn(recorded, 'witness'), false); continue; }
    const nodes = new Map(recorded.reachableNodes.map(node => [node.id, node])); const triples = new Set<string>();
    assert.equal(nodes.size, recorded.reachableNodes.length);
    for (const node of nodes.values()) {
      assert.ok(Number.isInteger(node.level) && node.level >= 0 && node.level < recorded.order.length);
      assert.notEqual(node.low, node.high); const triple = `${node.level}:${node.low}:${node.high}`; assert.ok(!triples.has(triple)); triples.add(triple);
      for (const child of [node.low, node.high]) if (child !== 0 && child !== 1) { assert.ok(nodes.has(child)); assert.ok(nodes.get(child)!.level > node.level); }
    }
    // Direct snapshot traversal uses no manager methods or computed cache.
    const evaluate = (root: number, assignment: Record<string, boolean>): boolean => {
      while (root > 1) { const node = nodes.get(root); assert.ok(node); root = assignment[recorded.order[node.level]] ? node.high : node.low; }
      assert.ok(root === 0 || root === 1); return root === 1;
    };
    if (experiment.oracle) for (const truth of truthTable(left, right, experiment.order)) {
      for (const name of Object.keys(truth.left)) {
        assert.equal(evaluate(recorded.left[name], truth.assignment), truth.left[name]);
        assert.equal(evaluate(recorded.right[name], truth.assignment), truth.right[name]);
        assert.equal(evaluate(recorded.differences[name], truth.assignment), truth.left[name] !== truth.right[name]);
      }
      assert.equal(evaluate(recorded.miter, truth.assignment), truth.differingOutputs.length > 0);
    }
  }
});
test('all original truth-table assignments and counterexamples replay exactly, including UNKNOWN runs', () => {
  for (const row of summary.experiments) {
    if (!row.oracle) continue;
    const oracle = row.oracle; assert.equal(hash(`results/${oracle.file}`), oracle.sha256);
    const left = parseCircuit(read(`data/circuits/${row.left}.json`)), right = parseCircuit(read(`data/circuits/${row.right}.json`));
    assert.deepEqual(oracle.inputOrder, row.order); assert.deepEqual(oracle.outputOrder, left.outputs.map(out => out.name).sort());
    const truths = truthTable(left, right, row.order); assert.equal(truths.length, oracle.assignments);
    const mismatches = truths.filter(truth => truth.differingOutputs.length > 0); assert.equal(mismatches.length, oracle.mismatches); assert.deepEqual(mismatches[0] ?? null, oracle.firstMismatch);
    const csv = ['input_bits,left_output_bits,right_output_bits,differing_outputs', ...truths.map(truth => [row.order.map(name => Number(truth.assignment[name])).join(''), oracle.outputOrder.map(name => Number(truth.left[name])).join(''), oracle.outputOrder.map(name => Number(truth.right[name])).join(''), truth.differingOutputs.join('|')].join(','))].join('\n') + '\n';
    assert.equal(read(`results/${oracle.file}`), csv);
  }
});
test('99 raw timing rows reconcile repetitions, counts and min/median/max without timing thresholds', () => {
  const lines = read('results/timings.csv').trim().split('\n'); assert.equal(lines.shift(), 'experiment,repetition,status,elapsed_ms,allocated_nodes,cache_entries,apply_calls,cache_hits');
  assert.equal(lines.length, summary.experiments.length * summary.repetitions);
  for (const row of summary.experiments) {
    const samples = lines.map(line => line.split(',')).filter(fields => fields[0] === row.id); assert.equal(samples.length, summary.repetitions);
    for (const [i, fields] of samples.entries()) {
      assert.equal(Number(fields[1]), i + 1); assert.equal(fields[2], row.status); assert.ok(Number.isFinite(Number(fields[3])) && Number(fields[3]) >= 0);
      assert.deepEqual(fields.slice(4).map(Number), [row.stats.allocatedNodes, row.stats.cacheEntries, row.stats.applyCalls, row.stats.cacheHits]);
    }
    const times = samples.map(fields => Number(fields[3])).sort((a, b) => a - b);
    assert.deepEqual(row.elapsedMs, { min: times[0], median: times[Math.floor(times.length / 2)], max: times.at(-1) });
  }
});
