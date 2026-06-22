import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

const PREVIOUS_HOME = process.env.HOME;
const PREVIOUS_XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME;
const tempHome = mkdtempSync(join(tmpdir(), 'agents-gui-mcp-home-'));
mkdirSync(join(tempHome, '.cc-switch'), { recursive: true });
mkdirSync(join(tempHome, '.config', 'opencode'), { recursive: true });
process.env.HOME = tempHome;
process.env.XDG_CONFIG_HOME = join(tempHome, '.config');

const dbPath = join(tempHome, '.cc-switch', 'cc-switch.db');
const opencodeConfigPath = join(tempHome, '.config', 'opencode', 'opencode.json');

const {
  CcSwitchMcpAdapter,
  sanitizeMcpServerConfig,
  validateMcpServerName,
  getMcpAdapter,
  registerMcpAdapter,
  UnsupportedMcpAdapter,
  McpConfigError,
  ccSwitchDbPath,
  openCodeConfigPath,
  syncOpenCodeConfig,
} = require('../.test-dist/mcpConfig.js');
const { McpManager } = require('../.test-dist/mcpManager.js');

function initTestDb() {
  rmSync(dbPath, { force: true });
  execSync(`sqlite3 "${dbPath}" "CREATE TABLE mcp_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, server_config TEXT NOT NULL, description TEXT, homepage TEXT, docs TEXT, tags TEXT NOT NULL DEFAULT '[]', enabled_claude BOOLEAN NOT NULL DEFAULT 0, enabled_codex BOOLEAN NOT NULL DEFAULT 0, enabled_gemini BOOLEAN NOT NULL DEFAULT 0, enabled_opencode BOOLEAN NOT NULL DEFAULT 0)"`);
}

function dumpRows() {
  return execSync(`sqlite3 -json "${dbPath}" "SELECT id, name, server_config, description, homepage, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode FROM mcp_servers ORDER BY id"`, { encoding: 'utf8' });
}

function readOpencodeConfig() {
  if (!existsSync(opencodeConfigPath)) {
    return null;
  }
  return JSON.parse(execSync(`cat "${opencodeConfigPath}"`, { encoding: 'utf8' }));
}

test('validateMcpServerName accepts simple names and rejects bad input', () => {
  assert.equal(validateMcpServerName('memory'), undefined);
  assert.equal(validateMcpServerName('my-mcp_1'), undefined);
  assert.ok(validateMcpServerName(''));
  assert.ok(validateMcpServerName('has space'));
  assert.ok(validateMcpServerName('a'.repeat(100)));
});

test('sanitizeMcpServerConfig normalizes local and remote servers', () => {
  const local = sanitizeMcpServerConfig({
    name: 'memory',
    type: 'local',
    command: ['npx', '-y', '@modelcontextprotocol/server-memory'],
    environment: { FOO: 'bar' },
  });
  assert.deepEqual(local.command, ['npx', '-y', '@modelcontextprotocol/server-memory']);
  assert.deepEqual(local.environment, { FOO: 'bar' });
  assert.equal(local.enabled, true);

  const remote = sanitizeMcpServerConfig({
    name: 'web',
    type: 'remote',
    url: 'https://example.com/mcp',
  });
  assert.equal(remote.type, 'remote');
  assert.equal(remote.url, 'https://example.com/mcp');
});

test('sanitizeMcpServerConfig rejects remote without http url', () => {
  assert.equal(sanitizeMcpServerConfig({ name: 'bad', type: 'remote', url: 'ftp://nope' }), undefined);
});

test('sanitizeMcpServerConfig rejects local without command', () => {
  assert.equal(sanitizeMcpServerConfig({ name: 'bad', type: 'local' }), undefined);
});

test('CcSwitchMcpAdapter returns empty list when db is missing', async () => {
  rmSync(dbPath, { force: true });
  const adapter = new CcSwitchMcpAdapter();
  const servers = await adapter.list();
  assert.deepEqual(servers, []);
});

test('CcSwitchMcpAdapter list reads stdio and http servers from db', async () => {
  initTestDb();
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('memory', 'memory', '{\\"type\\":\\"stdio\\",\\"command\\":\\"npx\\",\\"args\\":[\\"-y\\",\\"server-memory\\"]}', '[]', 1, 1, 0, 1)"`);
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('web', 'web', '{\\"type\\":\\"http\\",\\"url\\":\\"https://example.com/mcp\\"}', '[]', 0, 0, 0, 1)"`);

  const adapter = new CcSwitchMcpAdapter();
  const servers = await adapter.list();
  assert.equal(servers.length, 2);

  const memory = servers.find((s) => s.name === 'memory');
  assert.equal(memory.type, 'local');
  assert.deepEqual(memory.command, ['npx', '-y', 'server-memory']);
  assert.equal(memory.enabledByCli.claude, true);
  assert.equal(memory.enabledByCli.gemini, false);
  assert.equal(memory.enabledByCli.opencode, true);

  const web = servers.find((s) => s.name === 'web');
  assert.equal(web.type, 'remote');
  assert.equal(web.url, 'https://example.com/mcp');
});

test('CcSwitchMcpAdapter upsert inserts a row and syncs opencode.json', async () => {
  initTestDb();
  writeFileSync(
    opencodeConfigPath,
    JSON.stringify({ mcp: { manual: { enabled: true, type: 'local', command: ['manual'] } } }, null, 2),
    'utf8'
  );
  const adapter = new CcSwitchMcpAdapter();
  await adapter.upsert({
    name: 'figma',
    type: 'local',
    command: ['npx', '-y', 'figma-mcp'],
    environment: { FIGMA_API_KEY: 'xxx' },
    enabled: true,
    enabledByCli: { claude: true, codex: false, gemini: false, opencode: true },
  });

  const rows = JSON.parse(dumpRows());
  const figma = rows.find((r) => r.id === 'figma');
  assert.equal(figma.enabled_claude, 1);
  assert.equal(figma.enabled_codex, 0);
  assert.equal(figma.enabled_opencode, 1);

  const config = readOpencodeConfig();
  assert.ok(config.mcp.figma);
  assert.deepEqual(config.mcp.figma.command, ['npx', '-y', 'figma-mcp']);
  assert.equal(config.mcp.figma.enabled, true);
  assert.deepEqual(config.mcp.manual.command, ['manual']);
});

test('CcSwitchMcpAdapter upsert updates existing row preserving metadata', async () => {
  initTestDb();
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, description, homepage, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('memory', 'memory', '{\\"type\\":\\"stdio\\",\\"command\\":\\"old\\"}', 'desc', 'https://before', '[]', 1, 1, 1, 1)"`);

  const adapter = new CcSwitchMcpAdapter();
  await adapter.upsert({
    name: 'memory',
    type: 'local',
    command: ['npx', 'new'],
    enabled: true,
  });

  const rows = JSON.parse(dumpRows());
  const memory = rows.find((r) => r.id === 'memory');
  assert.equal(memory.description, 'desc');
  assert.equal(memory.homepage, 'https://before');
  assert.equal(memory.enabled_claude, 1);
  const config = JSON.parse(memory.server_config);
  assert.equal(config.command, 'npx');
  assert.deepEqual(config.args, ['new']);
});

test('CcSwitchMcpAdapter setEnabled toggles only enabled_opencode column', async () => {
  initTestDb();
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('a', 'a', '{\\"type\\":\\"stdio\\",\\"command\\":\\"x\\"}', '[]', 1, 1, 1, 1)"`);
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('b', 'b', '{\\"type\\":\\"stdio\\",\\"command\\":\\"y\\"}', '[]', 1, 1, 1, 1)"`);

  const adapter = new CcSwitchMcpAdapter();
  await adapter.setEnabled('b', false);

  const rows = JSON.parse(dumpRows());
  const a = rows.find((r) => r.id === 'a');
  const b = rows.find((r) => r.id === 'b');
  assert.equal(a.enabled_opencode, 1);
  assert.equal(b.enabled_opencode, 0);

  const config = readOpencodeConfig();
  assert.equal(config.mcp.a.enabled, true);
  assert.equal(config.mcp.b.enabled, false);
});

test('CcSwitchMcpAdapter remove deletes row and prunes opencode.json', async () => {
  initTestDb();
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('a', 'a', '{\\"type\\":\\"stdio\\",\\"command\\":\\"x\\"}', '[]', 1, 1, 1, 1)"`);
  execSync(`sqlite3 "${dbPath}" "INSERT INTO mcp_servers (id, name, server_config, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode) VALUES ('b', 'b', '{\\"type\\":\\"stdio\\",\\"command\\":\\"y\\"}', '[]', 1, 1, 1, 1)"`);

  const adapter = new CcSwitchMcpAdapter();
  await adapter.upsert({ name: 'a', type: 'local', command: ['x'], enabled: true });
  const beforeRemove = readOpencodeConfig();
  beforeRemove.mcp.manual = { enabled: true, type: 'local', command: ['manual'] };
  writeFileSync(opencodeConfigPath, JSON.stringify(beforeRemove, null, 2), 'utf8');
  await adapter.remove('b');

  const rows = JSON.parse(dumpRows());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'a');

  const config = readOpencodeConfig();
  assert.ok(config.mcp.a);
  assert.equal(config.mcp.b, undefined);
  assert.deepEqual(config.mcp.manual.command, ['manual']);
});

test('CcSwitchMcpAdapter upsert rejects invalid config', async () => {
  initTestDb();
  const adapter = new CcSwitchMcpAdapter();
  await assert.rejects(() => adapter.upsert({ name: 'bad name', type: 'local', command: ['x'] }));
});

test('CcSwitchMcpAdapter handles remote http server_config', async () => {
  initTestDb();
  const adapter = new CcSwitchMcpAdapter();
  await adapter.upsert({
    name: 'web',
    type: 'remote',
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer xyz' },
    enabled: true,
  });

  const servers = await adapter.list();
  const web = servers.find((s) => s.name === 'web');
  assert.equal(web.type, 'remote');
  assert.equal(web.url, 'https://api.example.com/mcp');
  assert.deepEqual(web.headers, { Authorization: 'Bearer xyz' });

  const config = readOpencodeConfig();
  assert.equal(config.mcp.web.type, 'remote');
  assert.equal(config.mcp.web.url, 'https://api.example.com/mcp');
});

test('UnsupportedMcpAdapter reports supported=false and refuses mutations', async () => {
  const adapter = new UnsupportedMcpAdapter('claude', '', 'no config');
  assert.equal(adapter.supported, false);
  assert.deepEqual(await adapter.list(), []);
  await assert.rejects(() => adapter.upsert({ name: 'x', type: 'local', command: ['npx'], enabled: true }));
});

test('getMcpAdapter returns CcSwitch adapter for opencode', () => {
  const opencode = getMcpAdapter('opencode');
  assert.equal(opencode.supported, true);
  assert.equal(opencode.cliId, 'opencode');

  const claude = getMcpAdapter('claude');
  assert.equal(claude.supported, false);
});

test('openCodeConfigPath ignores invalid XDG_CONFIG_HOME values', () => {
  process.env.XDG_CONFIG_HOME = 'undefined';
  assert.equal(openCodeConfigPath(), join(tempHome, '.config', 'opencode', 'opencode.json'));

  process.env.XDG_CONFIG_HOME = 'relative-config';
  assert.equal(openCodeConfigPath(), join(tempHome, '.config', 'opencode', 'opencode.json'));

  process.env.XDG_CONFIG_HOME = join(tempHome, '.config');
});

test('syncOpenCodeConfig preserves MCP entries it does not own', async () => {
  writeFileSync(
    opencodeConfigPath,
    JSON.stringify({
      mcp: {
        manual: { enabled: true, type: 'local', command: ['manual'] },
        stale: { enabled: true, type: 'local', command: ['stale'] },
      },
    }, null, 2),
    'utf8'
  );

  await syncOpenCodeConfig([
    { name: 'figma', type: 'local', command: ['npx', '-y', 'figma'], enabled: true },
  ]);
  let config = readOpencodeConfig();
  assert.deepEqual(config.mcp.manual.command, ['manual']);
  assert.deepEqual(config.mcp.stale.command, ['stale']);
  assert.deepEqual(config.mcp.figma.command, ['npx', '-y', 'figma']);

  await syncOpenCodeConfig([], { removeNames: ['stale'] });
  config = readOpencodeConfig();
  assert.deepEqual(config.mcp.manual.command, ['manual']);
  assert.equal(config.mcp.stale, undefined);
});

test('McpManager reports OpenCode MCP management unavailable when cc-switch db is absent', async () => {
  rmSync(dbPath, { force: true });
  const manager = new McpManager();
  const snapshot = await manager.snapshot('opencode');
  assert.equal(snapshot.supported, false);
  assert.match(snapshot.reason, /cc-switch SQLite database/);

  const result = await manager.upsert('opencode', { name: 'memory', type: 'local', command: ['npx'] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'mcp_unavailable');
});

test('ccSwitchDbPath resolves under HOME', () => {
  const resolved = ccSwitchDbPath();
  assert.ok(resolved.includes('.cc-switch'));
  assert.ok(resolved.endsWith('cc-switch.db'));
});

test.after(async () => {
  process.env.HOME = PREVIOUS_HOME;
  if (PREVIOUS_XDG_CONFIG_HOME === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = PREVIOUS_XDG_CONFIG_HOME;
  }
  rmSync(tempHome, { recursive: true, force: true });
});
