import assert from 'node:assert';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { OpenCodeConfigSync } from '../.test-dist/openCodeConfigSync.js';
import { EMPTY_API_PROVIDER_SETTINGS } from '../.test-dist/apiProviders.js';

function makeTempConfigPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-gui-oc-config-'));
  return path.join(dir, 'opencode', 'opencode.json');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('OpenCodeConfigSync writes provider and model into opencode.json', async () => {
  const configPath = makeTempConfigPath();
  const sync = new OpenCodeConfigSync({ configPath });

  await sync.sync({
    customProviders: [
      {
        id: 'mimo',
        name: 'Xiaomi MiMo',
        protocol: 'openai',
        baseUrl: 'https://api.mimo.example.com/v1',
        apiKey: 'secret-key',
        apiKeyEnv: '',
        model: 'mimo-v2.5-pro',
        models: ['mimo-v2.5-pro', 'mimo-v2.5'],
        extraEnv: {},
        enabled: true,
      },
    ],
    defaultProviderId: 'mimo',
    agentProviderByCliId: {},
  });

  const config = readJson(configPath);
  assert.ok(config.provider.agents_gui_mimo, 'should add provider entry');
  assert.equal(config.provider.agents_gui_mimo.name, 'Xiaomi MiMo');
  assert.equal(config.provider.agents_gui_mimo.npm, '@ai-sdk/openai-compatible');
  assert.equal(config.provider.agents_gui_mimo.options.apiKey, 'secret-key');
  assert.equal(config.provider.agents_gui_mimo.options.baseURL, 'https://api.mimo.example.com/v1');
  assert.ok(config.provider.agents_gui_mimo.models['mimo-v2.5-pro']);
  assert.equal(config.model, 'agents_gui_mimo/mimo-v2.5-pro');
});

test('OpenCodeConfigSync respects agentProviderByCliId.opencode over default', async () => {
  const configPath = makeTempConfigPath();
  const sync = new OpenCodeConfigSync({ configPath });

  await sync.sync({
    customProviders: [
      {
        id: 'anthropic-proxy',
        name: 'Anthropic Proxy',
        protocol: 'anthropic',
        baseUrl: 'https://anthropic.proxy.example.com',
        apiKey: '',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
        model: 'claude-sonnet-4',
        models: [],
        extraEnv: {},
        enabled: true,
      },
      {
        id: 'openai-proxy',
        name: 'OpenAI Proxy',
        protocol: 'openai',
        baseUrl: 'https://openai.proxy.example.com',
        apiKey: 'key',
        apiKeyEnv: '',
        model: 'gpt-5.5',
        models: [],
        extraEnv: {},
        enabled: true,
      },
    ],
    defaultProviderId: 'openai-proxy',
    agentProviderByCliId: { opencode: 'anthropic-proxy' },
  });

  const config = readJson(configPath);
  assert.ok(config.provider['agents_gui_anthropic-proxy'], 'should use opencode-specific provider');
  assert.equal(config.provider['agents_gui_anthropic-proxy'].npm, '@ai-sdk/anthropic');
  assert.equal(config.model, 'agents_gui_anthropic-proxy/claude-sonnet-4');
});

test('OpenCodeConfigSync removes stale synced providers when switching', async () => {
  const configPath = makeTempConfigPath();
  const sync = new OpenCodeConfigSync({ configPath });

  // First sync: provider A
  await sync.sync({
    customProviders: [
      { id: 'a', name: 'Provider A', protocol: 'openai', baseUrl: 'https://a.example.com', apiKey: 'key-a', apiKeyEnv: '', model: 'model-a', models: [], extraEnv: {}, enabled: true },
    ],
    defaultProviderId: 'a',
    agentProviderByCliId: {},
  });

  let config = readJson(configPath);
  assert.ok(config.provider.agents_gui_a);

  // Second sync: switch to provider B
  await sync.sync({
    customProviders: [
      { id: 'b', name: 'Provider B', protocol: 'openai', baseUrl: 'https://b.example.com', apiKey: 'key-b', apiKeyEnv: '', model: 'model-b', models: [], extraEnv: {}, enabled: true },
    ],
    defaultProviderId: 'b',
    agentProviderByCliId: {},
  });

  config = readJson(configPath);
  assert.ok(!config.provider.agents_gui_a, 'old synced provider should be removed');
  assert.ok(config.provider.agents_gui_b, 'new provider should be present');
  assert.equal(config.model, 'agents_gui_b/model-b');
});

test('OpenCodeConfigSync preserves user-defined providers and other config', async () => {
  const configPath = makeTempConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    agent: { 'my-agent': { mode: 'primary' } },
    provider: {
      'user-defined': {
        name: 'My Provider',
        npm: '@ai-sdk/openai-compatible',
        options: { apiKey: 'user-key' },
      },
    },
    mcp: { 'my-mcp': { type: 'remote', url: 'http://example.com' } },
  }, null, 2));

  const sync = new OpenCodeConfigSync({ configPath });

  await sync.sync({
    customProviders: [
      { id: 'synced', name: 'Synced', protocol: 'openai', baseUrl: 'https://synced.example.com', apiKey: 'synced-key', apiKeyEnv: '', model: 'synced-model', models: [], extraEnv: {}, enabled: true },
    ],
    defaultProviderId: 'synced',
    agentProviderByCliId: {},
  });

  const config = readJson(configPath);
  assert.equal(config.$schema, 'https://opencode.ai/config.json');
  assert.ok(config.agent['my-agent'], 'user agent config preserved');
  assert.ok(config.provider['user-defined'], 'user provider preserved');
  assert.ok(config.mcp['my-mcp'], 'mcp config preserved');
  assert.ok(config.provider.agents_gui_synced, 'synced provider added');
});

test('OpenCodeConfigSync does nothing when no provider is configured for opencode', async () => {
  const configPath = makeTempConfigPath();
  const sync = new OpenCodeConfigSync({ configPath });

  await sync.sync({ ...EMPTY_API_PROVIDER_SETTINGS });
  assert.ok(!fs.existsSync(configPath), 'config should not be created when no provider');
});

test('OpenCodeConfigSync creates a backup before mutating', async () => {
  const configPath = makeTempConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const original = { model: 'old-model', provider: { existing: { name: 'Old' } } };
  fs.writeFileSync(configPath, JSON.stringify(original, null, 2));

  const sync = new OpenCodeConfigSync({ configPath });

  await sync.sync({
    customProviders: [
      { id: 'new', name: 'New', protocol: 'openai', baseUrl: 'https://new.example.com', apiKey: 'key', apiKeyEnv: '', model: 'new-model', models: [], extraEnv: {}, enabled: true },
    ],
    defaultProviderId: 'new',
    agentProviderByCliId: {},
  });

  const dir = path.dirname(configPath);
  const files = fs.readdirSync(dir);
  const backups = files.filter((f) => f.includes('agents-gui-bak'));
  assert.ok(backups.length > 0, 'backup file should exist');

  const backupContent = readJson(path.join(dir, backups[0]));
  assert.equal(backupContent.model, 'old-model', 'backup should contain original content');
});
