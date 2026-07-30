import type * as vscode from 'vscode';
import type {
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import { CliManager } from './cliManager';

export interface OpenCodeAgentCapability {
  runPrompt(
    _prompt: string,
    _token: vscode.CancellationToken,
    _directory?: string,
    _modelId?: string,
    _onPartial?: (text: string) => void
  ): Promise<string>;
  getStatus(): Promise<AssistantOpenCodeStatus | undefined>;
  executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    _sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult>;
  deleteSession(sessionId: string | undefined): Promise<boolean>;
}

export class CliOpenCodeAgentCapability implements OpenCodeAgentCapability {
  constructor(_cliManager: CliManager) {}

  runPrompt(
    _prompt: string,
    _token: vscode.CancellationToken,
    _directory?: string,
    _modelId?: string,
    _onPartial?: (text: string) => void
  ): Promise<string> {
    return Promise.reject(new Error('OpenCode server transport is not available.'));
  }

  getStatus(): Promise<AssistantOpenCodeStatus | undefined> {
    return Promise.resolve(undefined);
  }

  executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    _sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    return Promise.resolve({
      command,
      ok: false,
      message: 'OpenCode server transport is not available.',
    });
  }

  deleteSession(_sessionId: string | undefined): Promise<boolean> {
    return Promise.resolve(false);
  }
}
