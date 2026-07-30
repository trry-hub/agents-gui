import { CliManager, type Session, type StartPromptOptions } from './cliManager';
import type { CliProfile } from './cliProfiles';

export type AgentSession = Session;

export interface AgentProfileStatusOptions {
  force?: boolean;
}

export interface AgentRuntime {
  checkInstalled(profileId: string): Promise<boolean>;
  getProfilesWithStatus(options?: AgentProfileStatusOptions): Promise<CliProfile[]>;
  startPrompt(
    cliId: string,
    initialInput?: string,
    options?: StartPromptOptions
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

  getProfilesWithStatus(options: AgentProfileStatusOptions = {}): Promise<CliProfile[]> {
    return this.cliManager.getProfilesWithStatus(options);
  }

  startPrompt(
    cliId: string,
    initialInput?: string,
    options: StartPromptOptions = {}
  ): Promise<AgentSession | null> {
    return this.cliManager.startPrompt(cliId, initialInput, options);
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
