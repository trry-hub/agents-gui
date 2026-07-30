import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

test('retired OpenCode local model state adapter is absent', () => {
  assert.equal(existsSync(new URL('../src/openCodeLocalState.ts', import.meta.url)), false);
});
