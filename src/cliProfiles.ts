import type { AgentCapability } from './agentCapabilities';

export interface CliAgentMode {
  id: string;
  label: string;
  description: string;
  instruction: string;
  disabled?: boolean;
}

export interface CliConfiguredModel {
  id: string;
  label: string;
  contextWindowTokens?: number;
}

export type CliAuthAction = 'login' | 'logout' | 'status';
export type CliAuthCommands = Partial<Record<CliAuthAction, string[]>>;
export type CliSlashCommandKind = 'local' | 'native';

export interface CliSlashCommand {
  name: string;
  aliases?: string[];
  kind: CliSlashCommandKind;
  local?: string;
  descriptionKey: string;
}

export type CliInstallPlatform = NodeJS.Platform | 'default';
export type CliInstallHints = Partial<Record<CliInstallPlatform, string>>;
export type CliTaskIntent =
  'planning' | 'implementation' | 'review' | 'tests' | 'refactor' | 'explain';
export type CliTaskRouting = Record<CliTaskIntent, number>;

export type CliTokenizerConfig =
  | { provider: 'openai'; encoding: 'o200k_base' | 'cl100k_base'; label: string }
  | { provider: 'anthropic'; label: string };

export interface CliProfile {
  id: string;
  name: string;
  description: string;
  command: string;
  versionArgs?: string[];
  contextWindowTokens?: number;
  autoCompactsContext?: boolean;
  tokenizer?: CliTokenizerConfig;
  /** Observed configuration only; this never affects process argv or env. */
  configuredModel?: CliConfiguredModel;
  /** Arguments required by the CLI's own one-shot prompt transport. */
  promptArgs: string[];
  inputMode: 'stdin' | 'argument';
  keepStdinOpen?: boolean;
  accent: string;
  icon: string;
  capabilities: string[];
  executionCapabilities: AgentCapability[];
  slashCommands?: CliSlashCommand[];
  taskRouting: CliTaskRouting;
  agentModes: CliAgentMode[];
  defaultAgentMode: string;
  installHint: string;
  installHints?: CliInstallHints;
  authCommands?: CliAuthCommands;
  installed: boolean;
  version?: string;
}

const CLAUDE_SLASH_COMMANDS: CliSlashCommand[] = [
  {
    name: 'terminal',
    aliases: ['terminal-setup'],
    kind: 'local',
    local: 'terminal',
    descriptionKey: 'slash.terminal.desc',
  },
];

const OPENCODE_SLASH_COMMANDS: CliSlashCommand[] = [
  {
    name: 'agents',
    aliases: ['agent'],
    kind: 'local',
    local: 'agents',
    descriptionKey: 'slash.agents.desc',
  },
  {
    name: 'mcps',
    aliases: ['mcp'],
    kind: 'local',
    local: 'mcp',
    descriptionKey: 'slash.mcps.desc',
  },
  { name: 'connect', kind: 'local', local: 'connect', descriptionKey: 'slash.connect.desc' },
  {
    name: 'org',
    aliases: ['orgs', 'switch-org'],
    kind: 'local',
    local: 'org',
    descriptionKey: 'slash.org.desc',
  },
  { name: 'status', kind: 'local', local: 'status', descriptionKey: 'slash.status.desc' },
  {
    name: 'themes',
    aliases: ['theme'],
    kind: 'local',
    local: 'themes',
    descriptionKey: 'slash.themes.desc',
  },
  {
    name: 'exit',
    aliases: ['quit', 'q'],
    kind: 'local',
    local: 'exit',
    descriptionKey: 'slash.exit.desc',
  },
  ...['undo', 'redo', 'compact', 'fork', 'share', 'unshare'].map((name) => ({
    name,
    kind: 'native' as const,
    descriptionKey: 'slash.native.desc',
  })),
];

const modes = (items: Array<[string, string, string, string]>): CliAgentMode[] =>
  items.map(([id, label, description, instruction]) => ({ id, label, description, instruction }));

export const CLI_PROFILES: CliProfile[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Strong project-aware coding agent for multi-file implementation and refactors.',
    command: 'claude',
    contextWindowTokens: 200000,
    autoCompactsContext: true,
    tokenizer: { provider: 'anthropic', label: 'Claude tokenizer' },
    promptArgs: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    inputMode: 'argument',
    accent: '#d97757',
    icon: '◆',
    capabilities: ['agent', 'multi-file', 'refactor'],
    executionCapabilities: [
      'workspace.read',
      'workspace.write',
      'terminal.execute',
      'sandbox.bypass',
    ],
    slashCommands: CLAUDE_SLASH_COMMANDS,
    taskRouting: { planning: 6, implementation: 5, review: 5, tests: 4, refactor: 6, explain: 5 },
    defaultAgentMode: 'build',
    agentModes: modes([
      [
        'build',
        'Build',
        'Claude Code implementation workflow.',
        'Claude Code build workflow: implement requested changes.',
      ],
      [
        'plan',
        'Plan',
        'Planning and analysis without changes.',
        'Claude Code plan workflow: inspect and propose a plan.',
      ],
      [
        'review',
        'Review',
        'Review-focused Claude Code workflow.',
        'Claude Code review workflow: lead with findings, risks, and missing tests before summary.',
      ],
    ]),
    installHint: 'npm install -g @anthropic-ai/claude-code',
    installHints: { default: 'npm install -g @anthropic-ai/claude-code' },
    authCommands: {
      login: ['auth', 'login'],
      logout: ['auth', 'logout'],
      status: ['auth', 'status'],
    },
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'General coding assistant with broad model support and fast project Q&A.',
    command: 'gemini',
    promptArgs: ['--output-format', 'text', '-p'],
    inputMode: 'argument',
    accent: '#4285f4',
    icon: 'G',
    capabilities: ['chat', 'analysis', 'workspace'],
    executionCapabilities: ['workspace.read', 'workspace.write', 'terminal.execute'],
    taskRouting: { planning: 4, implementation: 2, review: 3, tests: 2, refactor: 2, explain: 5 },
    defaultAgentMode: 'assist',
    agentModes: modes([
      [
        'assist',
        'Assist',
        'General Gemini CLI coding assistant.',
        'Gemini assist mode: answer directly and use project context.',
      ],
      [
        'plan',
        'Plan',
        'Planning and analysis without changes.',
        'Gemini plan mode: analyze the workspace and propose steps.',
      ],
      [
        'build',
        'Build',
        'Implementation-focused Gemini workflow.',
        'Gemini build mode: implement requested changes and report verification.',
      ],
    ]),
    installHint: 'npm install -g @google/gemini-cli',
    installHints: { default: 'npm install -g @google/gemini-cli' },
    installed: false,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    description: 'OpenAI coding agent for implementation, debugging, and code review workflows.',
    command: 'codex',
    contextWindowTokens: 258000,
    autoCompactsContext: true,
    tokenizer: { provider: 'openai', encoding: 'o200k_base', label: 'OpenAI o200k' },
    promptArgs: ['exec', '--color', 'never'],
    inputMode: 'argument',
    accent: '#10a37f',
    icon: 'C',
    capabilities: ['agent', 'patches', 'review'],
    executionCapabilities: [
      'workspace.read',
      'workspace.write',
      'terminal.execute',
      'sandbox.bypass',
    ],
    taskRouting: { planning: 5, implementation: 6, review: 6, tests: 5, refactor: 5, explain: 4 },
    defaultAgentMode: 'build',
    agentModes: modes([
      [
        'build',
        'Build',
        'Implementation-focused Codex workflow.',
        'Codex build workflow: implement requested changes and report verification clearly.',
      ],
      [
        'plan',
        'Plan',
        'Planning-focused Codex workflow.',
        'Codex plan workflow: inspect the workspace and propose concrete steps.',
      ],
      [
        'review',
        'Review',
        'Codex review-focused workflow.',
        'Codex review workflow: lead with findings, risks, and missing tests before summary.',
      ],
    ]),
    installHint: 'npm install -g @openai/codex',
    installHints: { default: 'npm install -g @openai/codex' },
    authCommands: { login: ['login'], logout: ['logout'], status: ['login', 'status'] },
    installed: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Terminal-native coding agent for fast codebase operations.',
    command: 'opencode',
    contextWindowTokens: 128000,
    autoCompactsContext: true,
    promptArgs: ['run', '--format', 'json'],
    inputMode: 'argument',
    accent: '#a855f7',
    icon: 'O',
    capabilities: ['agent', 'terminal', 'workspace'],
    executionCapabilities: ['workspace.read', 'workspace.write', 'terminal.execute'],
    slashCommands: OPENCODE_SLASH_COMMANDS,
    taskRouting: { planning: 2, implementation: 4, review: 2, tests: 3, refactor: 3, explain: 2 },
    defaultAgentMode: 'build',
    agentModes: modes([
      [
        'build',
        'build',
        'OpenCode build mode.',
        'OpenCode build mode: use the provider-native build workflow configured by OpenCode.',
      ],
      [
        'plan',
        'plan',
        'OpenCode plan mode.',
        'OpenCode plan mode: inspect the workspace and propose a plan before making changes.',
      ],
    ]),
    installHint: 'brew install opencode-ai/tap/opencode',
    installHints: {
      darwin: 'brew install opencode-ai/tap/opencode',
      linux: 'curl -fsSL https://opencode.ai/install | bash',
      win32: 'npm install -g opencode-ai',
      default: 'npm install -g opencode-ai',
    },
    authCommands: {
      login: ['auth', 'login'],
      logout: ['auth', 'logout'],
      status: ['auth', 'list'],
    },
    installed: false,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Automation-oriented agent for tool-using development tasks.',
    command: 'goose',
    promptArgs: ['run', '--quiet', '--output-format', 'text', '--text'],
    inputMode: 'argument',
    accent: '#f97316',
    icon: '⌂',
    capabilities: ['agent', 'automation', 'tools'],
    executionCapabilities: ['workspace.read', 'workspace.write', 'terminal.execute'],
    taskRouting: { planning: 2, implementation: 3, review: 1, tests: 3, refactor: 1, explain: 1 },
    defaultAgentMode: 'auto',
    agentModes: modes([
      [
        'auto',
        'Auto',
        'Goose automation-oriented agent.',
        'Goose auto mode: automate the requested development task and keep the user informed.',
      ],
      [
        'plan',
        'Plan',
        'Planning-only Goose workflow.',
        'Goose plan mode: inspect and outline a plan before automation.',
      ],
    ]),
    installHint:
      'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
    installHints: {
      darwin:
        'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
      linux:
        'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
      win32:
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/block/goose/releases/download/stable/download_cli.ps1 | iex"',
    },
    installed: false,
  },
  {
    id: 'aider',
    name: 'Aider',
    description: 'Git-aware pair programmer focused on editing files with model-backed patches.',
    command: 'aider',
    promptArgs: ['--message'],
    inputMode: 'argument',
    accent: '#22c55e',
    icon: 'A',
    capabilities: ['patches', 'git', 'tests'],
    executionCapabilities: ['workspace.read', 'workspace.write', 'terminal.execute'],
    taskRouting: { planning: 1, implementation: 4, review: 2, tests: 5, refactor: 4, explain: 1 },
    defaultAgentMode: 'edit',
    agentModes: modes([
      [
        'edit',
        'Edit',
        'Aider patch-oriented workflow.',
        'Aider edit mode: focus on precise patch generation and explain changed files.',
      ],
      [
        'architect',
        'Architect',
        'Aider planning and design workflow.',
        'Aider architect mode: reason about the change first and keep implementation guidance structured.',
      ],
    ]),
    installHint: 'pip install aider-install && aider-install',
    installHints: {
      win32:
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "python -m pip install aider-install; aider-install"',
      default: 'pip install aider-install && aider-install',
    },
    installed: false,
  },
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((p) => p.id === id);
}

export function resolveCliInstallHint(
  profile: Pick<CliProfile, 'installHint' | 'installHints'>,
  platform: NodeJS.Platform = process.platform
): string {
  return (
    profile.installHints?.[platform]?.trim() ||
    profile.installHints?.default?.trim() ||
    profile.installHint.trim()
  );
}

export function getCliAgentMode(profile: CliProfile, modeId?: string): CliAgentMode {
  const selectableModes = profile.agentModes.filter((mode) => !mode.disabled);
  return (
    selectableModes.find((mode) => mode.id === modeId) ??
    selectableModes.find((mode) => mode.id === profile.defaultAgentMode) ??
    selectableModes[0] ??
    profile.agentModes[0]
  );
}

const OPENAI_CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4.1': 1048576,
  'gpt-4.1-mini': 1048576,
  'gpt-4.1-nano': 1048576,
  'gpt-5.4': 128000,
  'gpt-5.5': 128000,
  o3: 200000,
  'o3-mini': 200000,
  'o4-mini': 200000,
};
const ANTHROPIC_CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  'claude-sonnet-4-20250514': 200000,
  'claude-opus-4-20250514': 200000,
  'claude-haiku-3.5': 200000,
};

export function inferTokenizerFromModelId(
  modelId: string | undefined
): CliTokenizerConfig | undefined {
  if (!modelId) return undefined;
  const [provider, ...rest] = modelId.split('/');
  const modelName = rest.join('/') || modelId;
  if (provider === 'openai' || provider === 'azure')
    return { provider: 'openai', encoding: 'o200k_base', label: 'OpenAI o200k' };
  if (provider === 'anthropic') return { provider: 'anthropic', label: 'Claude tokenizer' };
  if (provider === 'google' || provider === 'gemini')
    return { provider: 'openai', encoding: 'cl100k_base', label: 'SentencePiece (approx)' };
  if (modelName.includes('gpt-') || modelName.includes('o3') || modelName.includes('o4'))
    return { provider: 'openai', encoding: 'o200k_base', label: 'OpenAI o200k' };
  if (modelName.includes('claude')) return { provider: 'anthropic', label: 'Claude tokenizer' };
  return { provider: 'openai', encoding: 'o200k_base', label: 'o200k (default)' };
}

export function inferContextWindowTokens(modelId: string | undefined): number | undefined {
  if (!modelId) return undefined;
  const [provider, ...rest] = modelId.split('/');
  const modelName = rest.join('/') || modelId;
  if (rest.length === 0) {
    const openAiWindow = OPENAI_CONTEXT_WINDOW_TOKENS[modelId];
    const anthropicWindow = ANTHROPIC_CONTEXT_WINDOW_TOKENS[modelId];
    return openAiWindow !== undefined &&
      anthropicWindow !== undefined &&
      openAiWindow !== anthropicWindow
      ? undefined
      : (openAiWindow ?? anthropicWindow);
  }
  if (provider === 'openai' || provider === 'azure') return OPENAI_CONTEXT_WINDOW_TOKENS[modelName];
  if (provider === 'anthropic') return ANTHROPIC_CONTEXT_WINDOW_TOKENS[modelName];
  return undefined;
}

export function resolveContextWindowTokens(
  profile: Pick<CliProfile, 'contextWindowTokens'> | undefined,
  modelId: string | undefined
): number | undefined {
  return inferContextWindowTokens(modelId) ?? profile?.contextWindowTokens;
}
