import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { OpenCodeLocalState } = require('../.test-dist/openCodeLocalState.js');

test('OpenCodeLocalState reads model state and metadata from XDG paths', () => {
  const root = mkdtempSync(join(tmpdir(), 'agents-gui-opencode-state-'));
  try {
    const stateHome = join(root, 'state');
    const cacheHome = join(root, 'cache');
    mkdirSync(join(stateHome, 'opencode'), { recursive: true });
    mkdirSync(join(cacheHome, 'opencode'), { recursive: true });
    writeFileSync(
      join(stateHome, 'opencode', 'model.json'),
      JSON.stringify({
        current: { providerID: 'openai', modelID: 'gpt-5.5' },
        recent: [{ providerID: 'openai', modelID: 'gpt-5.4' }],
        variant: { 'openai/gpt-5.5': 'xhigh' },
      }),
      'utf8'
    );
    writeFileSync(
      join(cacheHome, 'opencode', 'models.json'),
      JSON.stringify({
        openai: {
          id: 'openai',
          models: {
            'gpt-5.5': {
              id: 'gpt-5.5',
              reasoning: true,
              reasoning_options: [{ type: 'effort', values: ['low', 'xhigh'] }],
            },
          },
        },
      }),
      'utf8'
    );

    const localState = new OpenCodeLocalState({
      env: {
        XDG_STATE_HOME: stateHome,
        XDG_CACHE_HOME: cacheHome,
      },
      homeDir: root,
      platform: 'linux',
    });

    assert.equal(localState.paths().modelStatePath, join(stateHome, 'opencode', 'model.json'));
    assert.equal(localState.readModelState().currentModelId, 'openai/gpt-5.5');
    assert.equal(localState.readModelState().currentVariant, 'xhigh');
    assert.deepEqual(localState.readModelMetadata()['openai/gpt-5.5'].variantOptions, ['low', 'xhigh']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('OpenCodeLocalState writes variants and falls back to Windows LOCALAPPDATA', async () => {
  const root = mkdtempSync(join(tmpdir(), 'agents-gui-opencode-win-state-'));
  try {
    const localAppData = join(root, 'LocalAppData');
    const localState = new OpenCodeLocalState({
      env: { LOCALAPPDATA: localAppData },
      homeDir: join(root, 'home'),
      platform: 'win32',
    });

    assert.equal(localState.paths().modelStatePath, join(localAppData, 'opencode', 'model.json'));

    await localState.updateModelVariant('openai/gpt-5.5', 'high');
    await localState.updateModelVariant('openai/gpt-5.4', 'low');

    const state = JSON.parse(readFileSync(localState.paths().modelStatePath, 'utf8'));
    assert.deepEqual(state.variant, {
      'openai/gpt-5.5': 'high',
      'openai/gpt-5.4': 'low',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
