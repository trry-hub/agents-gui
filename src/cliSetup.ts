import * as vscode from 'vscode';
import {
  CLI_PROFILES,
  getCliProfile,
  resolveCliInstallHint,
  type CliAuthAction,
  type CliProfile,
} from './cliProfiles';
import { runtimeT, type RuntimeLocale } from './localization';

type ProfileResolver = (cliId: string) => CliProfile | undefined;

export interface CliSetupProfile {
  id: string;
  name: string;
  description: string;
  installHint: string;
  installed: boolean;
  version?: string;
  icon?: string;
}

export function toCliSetupProfile(profile: CliProfile): CliSetupProfile {
  return {
    id: profile.id,
    name: profile.name,
    description: profile.description,
    installHint: resolveCliInstallHint(profile),
    installed: profile.installed,
    version: profile.version,
    icon: profile.icon,
  };
}

export class CliSetupController {
  private readonly setupTerminals = new Map<string, vscode.Terminal>();
  private readonly authTerminals = new Map<string, vscode.Terminal>();

  constructor(
    private readonly locale: RuntimeLocale,
    private readonly resolveProfile: ProfileResolver = (cliId) => getCliProfile(cliId)
  ) {}

  async copyInstallCommand(installCommand: unknown): Promise<void> {
    const text = typeof installCommand === 'string' ? installCommand.trim() : '';
    if (!text) {
      return;
    }
    await vscode.env.clipboard.writeText(text);
    vscode.window.showInformationMessage(
      runtimeT(this.locale, 'notification.installCommandCopied')
    );
  }

  async installCli(cliId: unknown): Promise<void> {
    const profileId = typeof cliId === 'string' ? cliId.trim() : '';
    const profile = CLI_PROFILES.find((item) => item.id === profileId);
    const command = profile ? resolveCliInstallHint(profile) : '';
    if (!profile || !command) {
      vscode.window.showWarningMessage(
        runtimeT(this.locale, 'error.unknownProvider', { provider: profileId || 'unknown' })
      );
      return;
    }

    let terminal = this.setupTerminals.get(profile.id);
    if (!terminal || terminal.exitStatus) {
      terminal = vscode.window.createTerminal({ name: `Agents GUI Setup: ${profile.name}` });
      this.setupTerminals.set(profile.id, terminal);
    }

    terminal.show(true);
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(runtimeT(this.locale, 'notification.installCommandSent'));
  }

  async runCliAuthAction(cliId: string, action: unknown): Promise<void> {
    const authAction = normalizeCliAuthAction(action);
    const profile = this.resolveProfile(cliId);
    const args = authAction ? profile?.authCommands?.[authAction] : undefined;
    if (!profile || !authAction || !args) {
      vscode.window.showWarningMessage(
        runtimeT(this.locale, 'providerAuth.unsupported', {
          provider: profile?.name || cliId || 'unknown',
        })
      );
      return;
    }

    let terminal = this.authTerminals.get(profile.id);
    if (!terminal || terminal.exitStatus) {
      terminal = vscode.window.createTerminal({ name: `Agents GUI Auth: ${profile.name}` });
      this.authTerminals.set(profile.id, terminal);
    }

    const command = [profile.command, ...args].map(shellQuote).join(' ');
    terminal.show(true);
    terminal.sendText(command, true);
    vscode.window.showInformationMessage(
      runtimeT(this.locale, 'notification.authCommandSent', { provider: profile.name })
    );
  }
}

export function normalizeCliAuthAction(action: unknown): CliAuthAction | undefined {
  return action === 'login' || action === 'logout' || action === 'status' ? action : undefined;
}

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
