import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
const cwd = new URL('..', import.meta.url);
const run = (...args: string[]) => spawnSync(process.execPath, ['scripts/cli.ts', ...args], { cwd, encoding: 'utf8' });
const left = 'data/circuits/adder_4_ripple.json', good = 'data/circuits/adder_4_prefix.json', bad = 'data/circuits/adder_4_faulty.json';
test('CLI distinguishes equivalent, inequivalent, unknown and invalid inputs by exit status', () => {
  for (const [expected, args] of [
    [0, ['compare', left, good]], [1, ['compare', left, bad]], [3, ['compare', left, bad, '--max-nodes', '0']],
    [2, ['compare', left]], [2, ['compare', left, good, '--max-nodes', '-1']], [2, ['compare', left, good, '--order', 'a0,a0']],
    [2, ['compare', 'missing.json', good]], [0, ['--help']], [0, ['-h']]
  ] as Array<[number, string[]]>) {
    const output = run(...args); assert.equal(output.status, expected, output.stderr); assert.ok(!output.stderr.includes('    at '));
    if (expected === 3) assert.equal(JSON.parse(output.stdout).status, 'UNKNOWN');
  }
});
test('CLI witness replay recomputes outputs and rejects a tampered non-distinguishing assignment', () => {
  const evidence = 'results/comparisons/adder-4-faulty.json';
  const output = run('replay', left, bad, evidence); assert.equal(output.status, 0); assert.deepEqual(JSON.parse(output.stdout).differingOutputs, ['s3']);
  const temporary = mkdtempSync(join(tmpdir(), 'circuit-replay-'));
  try {
    const saved = JSON.parse(readFileSync(new URL(`../${evidence}`, import.meta.url), 'utf8')) as { witness: { assignment: Record<string, boolean>; left: unknown; right: unknown } };
    saved.witness.left = {}; saved.witness.right = {}; const file = join(temporary, 'witness.json');
    writeFileSync(file, JSON.stringify(saved)); assert.equal(run('replay', left, bad, file).status, 0);
    for (const name of Object.keys(saved.witness.assignment)) saved.witness.assignment[name] = false;
    writeFileSync(file, JSON.stringify(saved)); const rejected = run('replay', left, bad, file); assert.equal(rejected.status, 2); assert.match(rejected.stderr, /does not distinguish/);
  } finally {
    const resolved = resolve(temporary);
    assert.ok(resolved.startsWith(resolve(tmpdir()) + sep) && basename(resolved).startsWith('circuit-replay-'));
    rmSync(resolved, { recursive: true, force: true });
  }
});
