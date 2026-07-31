import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  MINIMUM_NODE_VERSION,
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
} from '../scripts/node-version-policy.mjs';

test('enforces the frozen Node 22.22.1 engineering minimum', () => {
  assert.deepEqual(MINIMUM_NODE_VERSION, { major: 22, minor: 22, patch: 1 });
  assert.equal(isSupportedNodeVersion('18.20.8'), false);
  assert.equal(isSupportedNodeVersion('20.19.5'), false);
  assert.equal(isSupportedNodeVersion('22.22.0'), false);
  assert.equal(isSupportedNodeVersion('22.22.1'), true);
  assert.equal(isSupportedNodeVersion('22.30.0'), true);
  assert.equal(isSupportedNodeVersion('24.0.0'), true);
  assert.equal(isSupportedNodeVersion('v22.22.1'), true);
  assert.equal(isSupportedNodeVersion('not-a-version'), false);
  assert.throws(
    () => assertSupportedNodeVersion('20.19.5'),
    /Node\.js 22\.22\.1 or newer is required/
  );
});

test('pins Node 22 for local engineering', () => {
  assert.equal(readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim(), '22');
});

test('keeps the Node toolchain out of the VSIX and documents reproducible setup', () => {
  const vscodeIgnore = readFileSync(new URL('../.vscodeignore', import.meta.url), 'utf8');
  const contributing = readFileSync(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');

  assert.match(vscodeIgnore, /^\.nvmrc$/m);
  assert.match(contributing, /Node\.js 22\.22\.1\+/);
  assert.match(contributing, /^\s*npm ci\s*$/m);
  assert.doesNotMatch(contributing, /^\s*npm install\s*$/m);
});

test('uses the local VSCE 3.9.2 release toolchain', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const releaseWorkflow = readFileSync(
    new URL('../.github/workflows/release.yml', import.meta.url),
    'utf8'
  );

  assert.equal(manifest.devDependencies['@vscode/vsce'], '3.9.2');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '3.9.2');
  assert.equal(manifest.scripts['check:node'], 'node scripts/assert-node-version.mjs');
  assert.equal(manifest.scripts['publish:vsix'], 'npm run check:node && vsce publish');
  assert.doesNotMatch(releaseWorkflow, /npx[^\n]*@vscode\/vsce|npm exec[^\n]*vsce/i);
  assert.match(releaseWorkflow, /npm run publish:vsix -- --packagePath/);
});

test('runs CI only on the supported Node 22 toolchain', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const ciWorkflow = readFileSync(
    new URL('../.github/workflows/ci.yml', import.meta.url),
    'utf8'
  );
  const matrixNodeVersions = [
    ...ciWorkflow.matchAll(/node-version:\s*(?:"|')?(\d+\.x)/g),
  ].map((match) => match[1]);

  assert.deepEqual(matrixNodeVersions, ['22.x', '22.x']);
  assert.match(ciWorkflow, /windows-node-22/);
  assert.match(ciWorkflow, /ubuntu-node-22/);
  assert.match(ciWorkflow, /npm run package/);
  assert.match(
    ciWorkflow,
    /if:\s*matrix\.name == 'ubuntu-node-22'[\s\S]*?run:\s*npm run package/
  );
  assert.equal(manifest.engines.vscode, '^1.85.0');
  assert.equal(Object.hasOwn(manifest.engines, 'node'), false);
});
