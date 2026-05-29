import { CliManager, type Session } from './cliManager';
import type { CliProfile } from './cliProfiles';

export type AgentSession = Session;

export interface AgentStartPromptOptions {
  attachBackgroundServer?: boolean;
}

export interface AgentRuntime {
  checkInstalled(profileId: string): Promise<boolean>;
  getProfilesWithStatus(): Promise<CliProfile[]>;
  startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs?: string[],
    agentModeId?: string,
    optionKey?: string,
    envOverrides?: Record<string, string>,
    options?: AgentStartPromptOptions
  ): Promise<AgentSession | null>;
  sendInput(sessionId: string, text: string, closeAfterWrite?: boolean): boolean;
  stop(sessionId: string): void;
  stopAll(): void;
}

export class CliAgentRuntime implements AgentRuntime {
  constructor(private readonly cliManager: CliManager) {}

  checkInstalled(profileId: string): Promise<boolean> {
    return this.cliManager.checkInstalled(profileId);
  }

  getProfilesWithStatus(): Promise<CliProfile[]> {
    return this.cliManager.getProfilesWithStatus();
  }

  startPrompt(
    cliId: string,
    initialInput?: string,
    agentArgs: string[] = [],
    agentModeId?: string,
    optionKey?: string,
    envOverrides: Record<string, string> = {},
    options: AgentStartPromptOptions = {}
  ): Promise<AgentSession | null> {
    return this.cliManager.startPrompt(
      cliId,
      initialInput,
      agentArgs,
      agentModeId,
      optionKey,
      envOverrides,
      options
    );
  }

  sendInput(sessionId: string, text: string, closeAfterWrite = false): boolean {
    return this.cliManager.sendInput(sessionId, text, closeAfterWrite);
  }

  stop(sessionId: string): void {
    this.cliManager.stop(sessionId);
  }

  stopAll(): void {
    this.cliManager.stopAll();
  }
}
