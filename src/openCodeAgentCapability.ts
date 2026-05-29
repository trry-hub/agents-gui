import type * as vscode from 'vscode';
import type {
  AssistantOpenCodeNativeCommand,
  AssistantOpenCodeNativeCommandResult,
  AssistantOpenCodeStatus,
} from './assistantTypes';
import { CliManager } from './cliManager';

export interface OpenCodeAgentCapability {
  runPrompt(
    prompt: string,
    token: vscode.CancellationToken,
    directory?: string,
    modelId?: string,
    onPartial?: (text: string) => void
  ): Promise<string>;
  getStatus(): Promise<AssistantOpenCodeStatus | undefined>;
  executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult>;
  deleteSession(sessionId: string | undefined): Promise<boolean>;
}

export class CliOpenCodeAgentCapability implements OpenCodeAgentCapability {
  constructor(private readonly cliManager: CliManager) {}

  runPrompt(
    prompt: string,
    token: vscode.CancellationToken,
    directory?: string,
    modelId?: string,
    onPartial?: (text: string) => void
  ): Promise<string> {
    return this.cliManager.runOpenCodePromptViaServer(prompt, token, directory, modelId, onPartial);
  }

  getStatus(): Promise<AssistantOpenCodeStatus | undefined> {
    return this.cliManager.getOpenCodeStatus();
  }

  executeNativeCommand(
    command: AssistantOpenCodeNativeCommand,
    sessionId: string | undefined
  ): Promise<AssistantOpenCodeNativeCommandResult> {
    return this.cliManager.executeOpenCodeNativeCommand(command, sessionId);
  }

  deleteSession(sessionId: string | undefined): Promise<boolean> {
    return this.cliManager.deleteOpenCodeSession(sessionId);
  }
}
