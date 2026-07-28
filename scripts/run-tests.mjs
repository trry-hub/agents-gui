import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const testsDirectory = new URL('../tests/', import.meta.url);
const testFiles = readdirSync(testsDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.test.mjs'))
  .map((entry) => fileURLToPath(new URL(entry.name, testsDirectory)))
  .sort();

const result = spawnSync(
  process.execPath,
  ['--test', ...process.argv.slice(2), ...testFiles],
  { stdio: 'inherit' }
);
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
