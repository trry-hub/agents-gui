import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('test launcher consumes Node test options before explicit test files', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents-gui-test-runner-'));
  const scriptsDirectory = join(root, 'scripts');
  const testsDirectory = join(root, 'tests');
  mkdirSync(scriptsDirectory);
  mkdirSync(testsDirectory);
  const runnerPath = join(scriptsDirectory, 'run-tests.mjs');
  copyFileSync(new URL('../scripts/run-tests.mjs', import.meta.url), runnerPath);
  writeFileSync(
    join(testsDirectory, 'sample.test.mjs'),
    [
      "import assert from 'node:assert/strict';",
      "import test from 'node:test';",
      "test('runner option is consumed by Node', () => {",
      "  assert.equal(process.argv.includes('--test-concurrency=1'), false);",
      '});',
    ].join('\n'),
    'utf8'
  );

  try {
    const result = spawnSync(process.execPath, [runnerPath, '--test-concurrency=1'], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
