import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AgentCapabilityRegistry,
  AgentCapabilityResolutionError,
  resolveAgentCapabilityPolicy,
  resolveAgentTaskIntent,
} from '../.test-dist/agentCapabilities.js';
import { createCliAgentCapabilityRegistry } from '../.test-dist/cliAgentCapabilities.js';
import { CLI_PROFILES } from '../.test-dist/cliProfiles.js';

test('agent task intent prefers explicit editor actions over agent mode', () => {
  assert.equal(resolveAgentTaskIntent('freeform', 'plan'), 'planning');
  assert.equal(resolveAgentTaskIntent('freeform', 'review'), 'review');
  assert.equal(resolveAgentTaskIntent('freeform', 'build'), 'freeform');
  assert.equal(resolveAgentTaskIntent('reviewFile', 'build'), 'review');
  assert.equal(resolveAgentTaskIntent('generateTests', 'plan'), 'tests');
  assert.equal(resolveAgentTaskIntent('refactorSelection', 'plan'), 'refactor');
  assert.equal(resolveAgentTaskIntent('explainSelection', 'build'), 'explain');
});

test('planning and explanation stay read-only under broader permissions', () => {
  const expected = {
    required: ['workspace.read'],
    allowed: ['workspace.read'],
    denied: ['workspace.write', 'terminal.execute', 'sandbox.bypass'],
  };

  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'planning',
      permissionPosture: 'unrestricted',
    }),
    expected
  );
  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'explain',
      permissionPosture: 'workspace-write',
    }),
    expected
  );
});

test('implementation requires workspace writes when the posture permits edits', () => {
  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'implementation',
      permissionPosture: 'workspace-write',
    }),
    {
      required: ['workspace.read', 'workspace.write'],
      allowed: ['workspace.read', 'workspace.write', 'terminal.execute'],
      denied: ['sandbox.bypass'],
    }
  );

  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'implementation',
      permissionPosture: 'read-only',
    }),
    {
      required: ['workspace.read'],
      allowed: ['workspace.read'],
      denied: ['workspace.write', 'terminal.execute', 'sandbox.bypass'],
    }
  );
});

test('review can inspect and run checks but cannot edit files', () => {
  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'review',
      permissionPosture: 'workspace-write',
    }),
    {
      required: ['workspace.read'],
      allowed: ['workspace.read', 'terminal.execute'],
      denied: ['workspace.write', 'sandbox.bypass'],
    }
  );
});

test('freeform follows the selected permission posture', () => {
  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'freeform',
      permissionPosture: 'unrestricted',
    }),
    {
      required: ['workspace.read', 'sandbox.bypass'],
      allowed: ['workspace.read', 'workspace.write', 'terminal.execute', 'sandbox.bypass'],
      denied: [],
    }
  );
});

test('session continuation becomes an explicit required capability', () => {
  assert.deepEqual(
    resolveAgentCapabilityPolicy({
      intent: 'freeform',
      permissionPosture: 'workspace-write',
      resumeSession: true,
    }),
    {
      required: ['workspace.read', 'session.resume'],
      allowed: ['workspace.read', 'workspace.write', 'terminal.execute', 'session.resume'],
      denied: ['sandbox.bypass'],
    }
  );
});

test('capability registry selects the preferred compatible transport', () => {
  const registry = new AgentCapabilityRegistry([
    {
      providerId: 'demo',
      transports: [
        {
          kind: 'cli',
          capabilities: ['workspace.read', 'workspace.write'],
        },
        {
          kind: 'native',
          capabilities: ['workspace.read', 'workspace.write'],
        },
        {
          kind: 'acp',
          capabilities: ['workspace.read', 'workspace.write'],
        },
      ],
    },
  ]);

  const resolution = registry.resolve('demo', {
    required: ['workspace.read', 'workspace.write'],
    allowed: ['workspace.read', 'workspace.write'],
    denied: [],
  });

  assert.equal(resolution.transport, 'acp');
  assert.deepEqual(resolution.granted, ['workspace.read', 'workspace.write']);
});

test('capability registry falls back to a richer native transport', () => {
  const registry = new AgentCapabilityRegistry([
    {
      providerId: 'demo',
      transports: [
        {
          kind: 'cli',
          capabilities: ['workspace.read'],
        },
        {
          kind: 'acp',
          capabilities: ['workspace.read'],
        },
        {
          kind: 'native',
          capabilities: ['workspace.read', 'session.resume'],
        },
      ],
    },
  ]);

  const resolution = registry.resolve('demo', {
    required: ['workspace.read', 'session.resume'],
    allowed: ['workspace.read', 'session.resume'],
    denied: [],
  });

  assert.equal(resolution.transport, 'native');
  assert.deepEqual(resolution.granted, ['workspace.read', 'session.resume']);
});

test('capability registry reports unknown and incompatible providers', () => {
  const registry = new AgentCapabilityRegistry([
    {
      providerId: 'demo',
      transports: [{ kind: 'cli', capabilities: ['workspace.read'] }],
    },
  ]);
  const policy = {
    required: ['workspace.read', 'workspace.write'],
    allowed: ['workspace.read', 'workspace.write'],
    denied: [],
  };

  assert.throws(
    () => registry.resolve('missing', policy),
    (error) =>
      error instanceof AgentCapabilityResolutionError &&
      error.code === 'provider-not-registered' &&
      error.providerId === 'missing'
  );

  assert.throws(
    () => registry.resolve('demo', policy),
    (error) =>
      error instanceof AgentCapabilityResolutionError &&
      error.code === 'capability-not-supported' &&
      error.providerId === 'demo' &&
      assert.deepEqual(error.missingCapabilities, ['workspace.write']) === undefined
  );
});

test('capability errors distinguish a resolved but unavailable execution transport', () => {
  const error = new AgentCapabilityResolutionError('transport-not-supported', 'demo', [], 'acp');

  assert.equal(error.code, 'transport-not-supported');
  assert.equal(error.providerId, 'demo');
  assert.equal(error.transport, 'acp');
  assert.match(error.message, /transport "acp"/);
});

test('CLI profiles declare runtime capabilities and permission posture explicitly', () => {
  const validPostures = new Set(['read-only', 'workspace-write', 'unrestricted']);

  for (const profile of CLI_PROFILES) {
    assert.ok(profile.executionCapabilities.length > 0, profile.id);
    assert.ok(profile.executionCapabilities.includes('workspace.read'), profile.id);
    for (const permissionMode of profile.permissionModes ?? []) {
      assert.ok(validPostures.has(permissionMode.posture), `${profile.id}:${permissionMode.id}`);
    }
  }
});

test('CLI capability declarations expose only implemented elevated behavior', () => {
  const openCode = CLI_PROFILES.find((profile) => profile.id === 'opencode');
  assert.ok(openCode.executionCapabilities.includes('session.resume'));

  for (const providerId of ['claude', 'codex']) {
    const profile = CLI_PROFILES.find((candidate) => candidate.id === providerId);
    const dangerousModes = profile.permissionModes.filter((mode) => mode.dangerous);
    assert.ok(dangerousModes.length > 0, providerId);
    assert.ok(
      dangerousModes.every((mode) => mode.posture === 'unrestricted'),
      providerId
    );
    assert.ok(profile.executionCapabilities.includes('sandbox.bypass'), providerId);
  }

  for (const profile of CLI_PROFILES.filter(
    (candidate) => !['claude', 'codex'].includes(candidate.id)
  )) {
    assert.ok(!profile.executionCapabilities.includes('sandbox.bypass'), profile.id);
  }
});

test('CLI capability registry resolves every current provider through CLI', () => {
  const registry = createCliAgentCapabilityRegistry(CLI_PROFILES);
  const readPolicy = {
    required: ['workspace.read'],
    allowed: ['workspace.read'],
    denied: [],
  };

  for (const profile of CLI_PROFILES) {
    const resolution = registry.resolve(profile.id, readPolicy);
    assert.equal(resolution.transport, 'cli', profile.id);
    assert.deepEqual(resolution.granted, ['workspace.read'], profile.id);
  }
});
