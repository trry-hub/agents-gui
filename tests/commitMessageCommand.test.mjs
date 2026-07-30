import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');

class Uri {
  constructor(fsPath) {
    this.fsPath = fsPath;
  }
  toString() {
    return `file://${this.fsPath}`;
  }
}

class CancellationTokenSource {
  constructor() {
    this.listeners = new Set();
    this.token = {
      isCancellationRequested: false,
      onCancellationRequested: (listener) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      },
    };
  }
  cancel() {
    this.token.isCancellationRequested = true;
    for (const listener of this.listeners) listener();
  }
  dispose() {}
}

const state = {
  commitProvider: 'opencode',
  defaultProvider: 'opencode',
  repository: undefined,
  errors: [],
  infos: [],
};
const vscode = {
  Uri,
  CancellationTokenSource,
  ConfigurationTarget: { Global: 1 },
  ProgressLocation: { SourceControl: 1 },
  env: {
    language: 'en',
    clipboard: { async writeText() {} },
  },
  commands: {
    async executeCommand() {},
  },
  extensions: {
    getExtension(id) {
      if (id !== 'vscode.git') return undefined;
      return {
        isActive: true,
        exports: {
          enabled: true,
          getAPI() {
            return {
              repositories: [state.repository],
              getRepository(uri) {
                return uri?.fsPath === state.repository.rootUri.fsPath
                  ? state.repository
                  : null;
              },
            };
          },
        },
      };
    },
  },
  workspace: {
    getConfiguration(section) {
      return {
        get(key, fallback) {
          if (section === 'agents-gui.commitMessage' && key === 'provider') {
            return state.commitProvider ?? fallback;
          }
          if (section === 'agents-gui.commitMessage' && key === 'language') return 'auto';
          if (section === 'agents-gui.commitMessage' && key === 'maxDiffChars') return 60_000;
          if (section === 'agents-gui' && key === 'defaultProvider') {
            return state.defaultProvider;
          }
          return fallback;
        },
        async update() {},
      };
    },
  },
  window: {
    activeTextEditor: undefined,
    async withProgress(_options, task) {
      return task();
    },
    async showQuickPick() {
      return undefined;
    },
    async showInformationMessage(message) {
      state.infos.push(message);
      return undefined;
    },
    async showWarningMessage(message) {
      state.infos.push(message);
      return undefined;
    },
    async showErrorMessage(message) {
      state.errors.push(message);
      return undefined;
    },
  },
};
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  return request === 'vscode'
    ? vscode
    : originalLoad.call(this, request, parent, isMain);
};
const { CommitMessageCommand } = require('../.test-dist/commitMessageCommand.js');
Module._load = originalLoad;

function createRepository(input = 'original draft') {
  return {
    rootUri: new Uri('/repo'),
    inputBox: { value: input },
    state: { indexChanges: [{ uri: new Uri('/repo/a.ts') }] },
    ui: { selected: true },
    async diff() {
      return 'diff --git a/a.ts b/a.ts\n+change';
    },
  };
}

function reset() {
  state.commitProvider = 'opencode';
  state.defaultProvider = 'opencode';
  state.repository = createRepository();
  state.errors = [];
  state.infos = [];
}

test('SCM generation never overwrites a user edit after losing input ownership', async () => {
  reset();
  const registryCalls = [];
  const command = new CommitMessageCommand(
    {
      async isAvailable(providerId) {
        registryCalls.push(providerId);
        return true;
      },
    },
    {
      async execute(request) {
        request.onPartial('feat: partial');
        assert.equal(state.repository.inputBox.value, 'feat: partial');
        state.repository.inputBox.value = 'user edit';
        request.onPartial('feat: later partial');
        return { message: 'feat: final', providerId: 'opencode' };
      },
    }
  );

  await command.run(state.repository.rootUri);

  assert.equal(state.repository.inputBox.value, 'user edit');
  assert.deepEqual(registryCalls, ['opencode']);
});

test('SCM generation restores the original draft only while it still owns the input', async () => {
  for (const userEdits of [false, true]) {
    reset();
    const command = new CommitMessageCommand(
      { async isAvailable() { return true; } },
      {
        async execute(request) {
          request.onPartial('feat: partial');
          if (userEdits) state.repository.inputBox.value = 'user edit';
          throw new Error('generation failed');
        },
      }
    );

    await command.run(state.repository.rootUri);
    assert.equal(
      state.repository.inputBox.value,
      userEdits ? 'user edit' : 'original draft'
    );
  }
});

test('invalid explicit and default provider IDs abort before registry or generation calls', async () => {
  for (const configuration of [
    { commitProvider: 'not-a-cli', defaultProvider: 'opencode' },
    { commitProvider: 'default', defaultProvider: 'not-a-cli' },
  ]) {
    reset();
    Object.assign(state, configuration);
    let registryCalls = 0;
    let generationCalls = 0;
    const command = new CommitMessageCommand(
      {
        async isAvailable() {
          registryCalls += 1;
          return true;
        },
      },
      {
        async execute() {
          generationCalls += 1;
          return { message: 'feat: generated', providerId: 'opencode' };
        },
      }
    );

    await command.run(state.repository.rootUri);

    assert.equal(registryCalls, 0);
    assert.equal(generationCalls, 0);
    assert.equal(state.repository.inputBox.value, 'original draft');
    assert.ok(state.errors.some((message) => /not-a-cli/.test(message)));
  }
});
