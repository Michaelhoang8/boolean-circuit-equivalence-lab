import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtures } from '../src/fixtures.ts';
mkdirSync('data/circuits', { recursive: true });
const { circuits, experiments } = fixtures();
for (const [name, circuit] of Object.entries(circuits)) writeFileSync(`data/circuits/${name}.json`, JSON.stringify(circuit, null, 2) + '\n');
writeFileSync('data/experiments.json', JSON.stringify(experiments, null, 2) + '\n');
console.log(`Generated ${Object.keys(circuits).length} synthetic circuits and ${experiments.length} fixed experiments.`);
