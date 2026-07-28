import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const pathModule = require('node:path');
const {
  buildCliLookupPath,
  mergePathEntries,
  normalizeCommandPathOutput,
  withCliLookupPath,
} = require('../.test-dist/cliPathResolver.js');

function loadResolverWithHostPath(hostPath) {
  const resolverPath = require.resolve('../.test-dist/cliPathResolver.js');
  const originalLoad = Module._load;
  delete require.cache[resolverPath];
  Module._load = function (request, parent, isMain) {
    return request === 'path'
      ? hostPath
      : originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require(resolverPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[resolverPath];
  }
}

test('buildCliLookupPath adds and deduplicates Windows user CLI locations', () => {
  const result = buildCliLookupPath({
    platform: 'win32',
    homeDir: 'C:\\Users\\Agent',
    env: {
      Path: 'C:\\Existing;C:\\USERS\\AGENT\\AppData\\Roaming\\npm',
      APPDATA: 'C:\\Users\\Agent\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\Agent\\AppData\\Local',
      ProgramData: 'C:\\ProgramData',
      USERPROFILE: 'C:\\Users\\Agent',
    },
  }).split(';');

  assert.equal(result[0], 'C:\\Existing');
  assert.equal(
    result.filter((entry) => entry.toLowerCase().endsWith('\\appdata\\roaming\\npm')).length,
    1
  );
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Local\\Microsoft\\WindowsApps'));
  assert.ok(result.includes('C:\\Users\\Agent\\scoop\\shims'));
  assert.ok(result.includes('C:\\ProgramData\\chocolatey\\bin'));
  assert.ok(result.includes('C:\\Users\\Agent\\.local\\bin'));
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Roaming\\Python\\Scripts'));
  assert.ok(result.includes('C:\\Users\\Agent\\AppData\\Local\\Programs\\Python\\Scripts'));
});

test('mergePathEntries uses requested Windows semantics on a simulated POSIX host', () => {
  const simulatedHostPath = {
    ...pathModule,
    delimiter: pathModule.posix.delimiter,
  };
  const resolver = loadResolverWithHostPath(simulatedHostPath);
  assert.equal(
    resolver.mergePathEntries(['C:\\One;C:\\Two', 'c:\\one', 'C:\\Three'], 'win32'),
    'C:\\One;C:\\Two;C:\\Three'
  );
});

test('mergePathEntries uses requested POSIX semantics on a simulated Windows host', () => {
  const simulatedHostPath = {
    ...pathModule,
    delimiter: pathModule.win32.delimiter,
  };
  const resolver = loadResolverWithHostPath(simulatedHostPath);
  assert.equal(
    resolver.mergePathEntries(['/usr/local/bin:/usr/bin', '/opt/bin'], 'linux'),
    '/usr/local/bin:/usr/bin:/opt/bin'
  );
});

test('withCliLookupPath emits one canonical PATH key on Windows', () => {
  const env = withCliLookupPath(
    { Path: 'C:\\Existing', FOO: 'bar' },
    ['C:\\Resolved Command'],
    'win32'
  );
  assert.equal(env.PATH, 'C:\\Resolved Command;C:\\Existing');
  assert.equal(env.Path, undefined);
  assert.equal(env.FOO, 'bar');
});

test('withCliLookupPath gives later case-insensitive Windows PATH overrides precedence', () => {
  const env = withCliLookupPath(
    {
      Path: 'C:\\Inherited',
      PATH: 'C:\\Provider Override',
    },
    [],
    'win32'
  );

  assert.equal(env.PATH.split(';')[0], 'C:\\Provider Override');
});

test('withCliLookupPath keeps POSIX PATH lookup case-sensitive', () => {
  const env = withCliLookupPath(
    {
      Path: '/not-the-posix-path',
      PATH: '/provider-override',
    },
    [],
    'linux'
  );

  assert.equal(env.PATH.split(':')[0], '/provider-override');
  assert.equal(env.Path, '/not-the-posix-path');
});

test('normalizeCommandPathOutput prefers native Windows executables over shims', () => {
  const output = [
    'C:\\Users\\Agent\\AppData\\Roaming\\npm\\codex.cmd',
    'C:\\Tools\\codex.exe',
    '\\\\server\\share\\codex.bat',
  ].join('\r\n');
  assert.equal(normalizeCommandPathOutput(output, 'win32'), 'C:\\Tools\\codex.exe');
});

test('normalizeCommandPathOutput accepts UNC Windows command paths', () => {
  assert.equal(
    normalizeCommandPathOutput('noise\r\n\\\\server\\share\\opencode.cmd\r\n', 'win32'),
    '\\\\server\\share\\opencode.cmd'
  );
});

test('normalizeCommandPathOutput preserves first-match behavior on POSIX', () => {
  assert.equal(
    normalizeCommandPathOutput('noise\n/usr/local/bin/codex\n/usr/bin/codex\n', 'linux'),
    '/usr/local/bin/codex'
  );
});
