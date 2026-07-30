import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveOpenCodePaths } = require('../.test-dist/openCodePaths.js');

test('Windows OpenCode paths prefer existing APPDATA config', () => {
  const existing = new Set(['C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json']);
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
      USERPROFILE: 'C:\\Users\\Agent',
    },
    exists: (candidate) => existing.has(candidate),
  });
  assert.equal(
    paths.configPath,
    'C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json'
  );
  assert.equal('modelStatePath' in paths, false);
  assert.equal('modelMetadataPath' in paths, false);
});

test('Windows OpenCode paths read an existing legacy config before creating APPDATA config', () => {
  const legacy = 'C:\\Users\\Agent\\.config\\opencode\\opencode.json';
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
    },
    exists: (candidate) => candidate === legacy,
  });
  assert.equal(paths.configPath, legacy);
});

test('Windows OpenCode paths create new config under APPDATA when neither file exists', () => {
  const paths = resolveOpenCodePaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
    },
    exists: () => false,
  });
  assert.equal(
    paths.configPath,
    'C:\\Users\\Agent\\AppData\\Roaming\\opencode\\opencode.json'
  );
});

test('Linux OpenCode paths preserve XDG config', () => {
  const paths = resolveOpenCodePaths({
    platform: 'linux',
    homeDir: '/home/agent',
    env: {
      XDG_CONFIG_HOME: '/xdg/config',
    },
    exists: () => false,
  });
  assert.equal(paths.configPath, '/xdg/config/opencode/opencode.json');
  assert.equal('stateHome' in paths, false);
  assert.equal('cacheHome' in paths, false);
});
