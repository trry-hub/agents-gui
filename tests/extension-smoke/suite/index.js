const assert = require('node:assert/strict');
const vscode = require('vscode');

async function run() {
  const extension = vscode.extensions.all.find((item) => item.packageJSON?.name === 'agents-gui');
  assert.ok(extension, 'Agents GUI extension must be loaded in the Extension Development Host.');

  await extension.activate();
  await vscode.commands.executeCommand('agents-gui.openPanel');
  await vscode.commands.executeCommand('agents-gui.refreshProviders');
  await vscode.commands.executeCommand('agents-gui.stopAll');

  const result = await vscode.commands.executeCommand('agents-gui.internal.runSmoke');
  assert.equal(result?.ok, true, JSON.stringify(result, null, 2));

  for (const command of [
    'profiles',
    'contextSummary',
    'requestStarted',
    'output',
    'stopped',
  ]) {
    assert.ok(
      result.postedCommands.includes(command),
      `expected smoke probe to post ${command}`
    );
  }

  assert.equal(result.startedPrompts, 2);
  assert.equal(result.sentInputs, 0);
  assert.equal(result.contextWindowTokens, 321_000);
  assert.ok(result.stoppedSessions.some((sessionId) => sessionId.startsWith('smoke-opencode-')));
  assert.ok(result.outputTexts.some((text) => text.includes('smoke reply')));
}

module.exports = { run };
