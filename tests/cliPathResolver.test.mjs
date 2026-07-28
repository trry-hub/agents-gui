import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildCliLookupPath,
  mergePathEntries,
  normalizeCommandPathOutput,
  withCliLookupPath,
} = require('../.test-dist/cliPathResolver.js');

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

test('mergePathEntries uses Windows delimiter and case-insensitive first-match precedence', () => {
  assert.equal(
    mergePathEntries(['C:\\One;C:\\Two', 'c:\\one', 'C:\\Three'], 'win32'),
    'C:\\One;C:\\Two;C:\\Three'
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
