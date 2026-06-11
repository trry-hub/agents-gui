export interface CliAgentMode {
  id: string;
  label: string;
  description: string;
  instruction: string;
  /** Extra CLI args inserted before the prompt */
  args?: string[];
  disabled?: boolean;
}

export interface CliProfileOption {
  id: string;
  label: string;
  summaryLabel?: string;
  description: string;
  args?: string[];
  dangerous?: boolean;
  disabled?: boolean;
  actionOnly?: boolean;
  external?: boolean;
  dividerBefore?: boolean;
}

export interface CliModelOption extends CliProfileOption {
  custom?: boolean;
  configuredModelId?: string;
  variant?: string;
  variantOptions?: string[];
}

export interface CliRuntimeMode extends CliProfileOption {}

export interface CliPermissionMode extends CliProfileOption {
  instruction?: string;
}

export interface CliOptionSelection {
  model?: string;
  customModel?: string;
  runtime?: string;
  permissionMode?: string;
}

export type CliSlashCommandKind = 'local' | 'native';

export interface CliSlashCommand {
  name: string;
  aliases?: string[];
  kind: CliSlashCommandKind;
  /** Local webview action name. Native commands are delegated to provider-specific bridges. */
  local?: string;
  descriptionKey: string;
  /** The extension can execute this native command through a structured provider API. */
  nativeApi?: boolean;
}

export type CliTaskIntent =
  | 'planning'
  | 'implementation'
  | 'review'
  | 'tests'
  | 'refactor'
  | 'explain';

export type CliTaskRouting = Record<CliTaskIntent, number>;

export type CliTokenizerConfig =
  | {
      provider: 'openai';
      encoding: 'o200k_base' | 'cl100k_base';
      label: string;
    }
  | {
      provider: 'anthropic';
      label: string;
    };

export interface CliProfile {
  id: string;
  name: string;
  description: string;
  command: string;
  /** Arguments used to query the CLI version. Defaults to --version. */
  versionArgs?: string[];
  /** Known context window size for the default provider model, when the CLI exposes one. */
  contextWindowTokens?: number;
  /** Whether the provider is expected to compact older background context automatically. */
  autoCompactsContext?: boolean;
  /** Tokenizer family used to estimate locally attached context usage. */
  tokenizer?: CliTokenizerConfig;
  /** Provider-native model presets shown in the composer. */
  modelOptions?: CliModelOption[];
  defaultModel?: string;
  customModelArgPrefix?: string[];
  /** Runtime/backend choices such as hosted API or local OSS provider. */
  runtimeModes?: CliRuntimeMode[];
  defaultRuntime?: string;
  /** Permission/sandbox choices kept separate from workflow intent. */
  permissionModes?: CliPermissionMode[];
  defaultPermissionMode?: string;
  /** Arguments for non-interactive prompt mode */
  promptArgs: string[];
  /** Optional background server used to make subsequent non-interactive runs faster */
  backgroundServer?: {
    args: string[];
    attachArgs: string[];
    url: string;
    portRange?: {
      start: number;
      size: number;
    };
  };
  /** How the prompt is delivered to the process */
  inputMode: 'stdin' | 'argument';
  /** Keep stdin open after sending a prompt. Headless stdin CLIs usually need EOF, so this defaults to false. */
  keepStdinOpen?: boolean;
  /** Brand accent color (hex) */
  accent: string;
  /** Brand icon emoji or short label */
  icon: string;
  /** Capability labels shown in the assistant workbench */
  capabilities: string[];
  /** Provider-owned slash commands and native controls exposed by the webview. */
  slashCommands?: CliSlashCommand[];
  /** Task-fit scores used by the workbench recommendation engine */
  taskRouting: CliTaskRouting;
  /** Provider-native agent/mode presets shown in the composer */
  agentModes: CliAgentMode[];
  defaultAgentMode: string;
  /** Install hint shown when CLI is not found */
  installHint: string;
  env?: Record<string, string>;
  installed: boolean;
  version?: string;
}

const CLAUDE_SLASH_COMMANDS: CliSlashCommand[] = [
  { name: 'model', kind: 'local', local: 'model', descriptionKey: 'slash.model.desc' },
  {
    name: 'permissions',
    aliases: ['permission'],
    kind: 'local',
    local: 'permissions',
    descriptionKey: 'slash.permissions.desc',
  },
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
    name: 'sessions',
    aliases: ['session', 'resume', 'continue'],
    kind: 'local',
    local: 'sessions',
    descriptionKey: 'slash.sessions.desc',
  },
  {
    name: 'models',
    aliases: ['model'],
    kind: 'local',
    local: 'models',
    descriptionKey: 'slash.models.desc',
  },
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
  { name: 'variants', kind: 'local', local: 'variants', descriptionKey: 'slash.variants.desc' },
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
    nativeApi: true,
  })),
];

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
    slashCommands: CLAUDE_SLASH_COMMANDS,
    taskRouting: {
      planning: 6,
      implementation: 5,
      review: 5,
      tests: 4,
      refactor: 6,
      explain: 5,
    },
    defaultAgentMode: 'build',
    agentModes: [
      {
        id: 'build',
        label: 'Build',
        description: 'Claude Code implementation workflow.',
        instruction:
          'Claude Code build workflow: implement requested changes when allowed by the selected permission mode.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning and analysis without changes.',
        instruction:
          'Claude Code plan workflow: inspect and propose a plan. Do not edit files unless the user explicitly approves execution.',
      },
      {
        id: 'review',
        label: 'Review',
        description: 'Review-focused Claude Code workflow.',
        instruction:
          'Claude Code review workflow: lead with findings, risks, and missing tests before summary.',
      },
    ],
    defaultModel: 'configured',
    customModelArgPrefix: ['--model'],
    modelOptions: [
      {
        id: 'configured',
        label: 'Configured',
        summaryLabel: 'Configured',
        description: 'Use the Claude Code model configured in settings or environment variables.',
      },
      {
        id: 'sonnet',
        label: 'Sonnet',
        description: 'Use Claude Code latest Sonnet alias.',
        args: ['--model', 'sonnet'],
      },
      {
        id: 'opus',
        label: 'Opus',
        description: 'Use Claude Code latest Opus alias.',
        args: ['--model', 'opus'],
      },
      {
        id: 'custom',
        label: 'Custom',
        description: 'Enter a Claude Code model alias or full model id.',
        custom: true,
      },
    ],
    defaultRuntime: 'defaultEffort',
    runtimeModes: [
      {
        id: 'defaultEffort',
        label: 'Default effort',
        summaryLabel: 'Default effort',
        description: 'Use the Claude Code configured effort level.',
      },
      {
        id: 'effortLow',
        label: 'Low effort',
        summaryLabel: 'Effort low',
        description: 'Use lower reasoning effort for fast/simple tasks.',
        args: ['--effort', 'low'],
      },
      {
        id: 'effortMedium',
        label: 'Medium effort',
        summaryLabel: 'Effort medium',
        description: 'Use medium reasoning effort.',
        args: ['--effort', 'medium'],
      },
      {
        id: 'effortHigh',
        label: 'High effort',
        summaryLabel: 'Effort high',
        description: 'Use high reasoning effort for complex changes.',
        args: ['--effort', 'high'],
      },
      {
        id: 'effortXhigh',
        label: 'XHigh effort',
        summaryLabel: 'Effort xhigh',
        description: 'Use extra-high reasoning effort when the selected model supports it.',
        args: ['--effort', 'xhigh'],
      },
      {
        id: 'effortMax',
        label: 'Max effort',
        summaryLabel: 'Effort max',
        description: 'Use maximum reasoning effort when the selected model supports it.',
        args: ['--effort', 'max'],
      },
    ],
    defaultPermissionMode: 'default',
    permissionModes: [
      {
        id: 'default',
        label: 'Default',
        description: 'Claude Code default permission mode.',
        instruction:
          'Claude Code default permission mode: read freely and ask before edits or shell actions that need approval.',
        args: ['--permission-mode', 'default'],
      },
      {
        id: 'acceptEdits',
        label: 'Accept Edits',
        description: 'Claude Code can edit files without asking each time.',
        instruction:
          'Claude Code acceptEdits permission mode: allow file edits and common filesystem commands while still surfacing important risks.',
        args: ['--permission-mode', 'acceptEdits'],
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Claude Code permission mode for planning before changes.',
        instruction:
          'Claude Code plan permission mode: inspect and propose a plan. Do not edit files unless the user explicitly approves execution.',
        args: ['--permission-mode', 'plan'],
      },
      {
        id: 'auto',
        label: 'Auto',
        description: 'Claude Code auto mode when the local account supports it.',
        instruction:
          'Claude Code auto permission mode: proceed autonomously within Claude Code safety checks and summarize verification clearly.',
        args: ['--permission-mode', 'auto'],
      },
      {
        id: 'dontAsk',
        label: "Don't Ask",
        description: 'Claude Code only uses pre-approved tools.',
        instruction:
          'Claude Code dontAsk permission mode: stay within pre-approved tools and explain blockers instead of requesting broad permissions.',
        args: ['--permission-mode', 'dontAsk'],
      },
      {
        id: 'bypassPermissions',
        label: 'Bypass',
        description: 'Claude Code bypass permissions mode for isolated environments only.',
        instruction:
          'Claude Code bypassPermissions permission mode: act carefully, keep edits scoped, and call out risky operations explicitly.',
        args: ['--permission-mode', 'bypassPermissions'],
        dangerous: true,
      },
    ],
    installHint: 'curl -fsSL https://claude.ai/install.sh | bash',
    installed: false,
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: 'General coding assistant with broad model support and fast project Q&A.',
    command: 'gemini',
    promptArgs: ['--skip-trust', '--approval-mode', 'plan', '--output-format', 'text', '-p'],
    inputMode: 'argument',
    env: {
      GEMINI_CLI_NO_RELAUNCH: '1',
    },
    accent: '#4285f4',
    icon: 'G',
    capabilities: ['chat', 'analysis', 'workspace'],
    taskRouting: {
      planning: 4,
      implementation: 2,
      review: 3,
      tests: 2,
      refactor: 2,
      explain: 5,
    },
    defaultAgentMode: 'assist',
    agentModes: [
      {
        id: 'assist',
        label: 'Assist',
        description: 'General Gemini CLI coding assistant.',
        instruction:
          'Gemini assist mode: answer directly, use project context, and keep changes suggested unless explicitly requested.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning and analysis without changes.',
        instruction:
          'Gemini plan mode: analyze the workspace and propose steps without making code changes.',
      },
      {
        id: 'build',
        label: 'Build',
        description: 'Implementation-focused Gemini workflow.',
        instruction:
          'Gemini build mode: implement requested changes when possible and report verification steps.',
      },
    ],
    installHint: 'npm install -g @google/gemini-cli',
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
    promptArgs: ['-a', 'never', 'exec', '--color', 'never', '--ephemeral'],
    inputMode: 'argument',
    accent: '#10a37f',
    icon: 'C',
    capabilities: ['agent', 'patches', 'review'],
    taskRouting: {
      planning: 5,
      implementation: 6,
      review: 6,
      tests: 5,
      refactor: 5,
      explain: 4,
    },
    defaultModel: 'configured',
    customModelArgPrefix: ['--model'],
    modelOptions: [
      {
        id: 'configured',
        label: 'Configured',
        summaryLabel: 'Configured',
        description: 'Use the model configured by Codex CLI settings or environment variables.',
      },
      {
        id: 'gpt-5.5',
        label: 'GPT-5.5',
        description: 'Frontier model for complex coding, research, and real-world work.',
        args: ['--model', 'gpt-5.5'],
      },
      {
        id: 'gpt-5.4',
        label: 'GPT-5.4',
        description: 'Strong model for everyday coding.',
        args: ['--model', 'gpt-5.4'],
      },
      {
        id: 'gpt-5.4-mini',
        label: 'GPT-5.4 Mini',
        description: 'Fast, cost-efficient coding model.',
        args: ['--model', 'gpt-5.4-mini'],
      },
      {
        id: 'gpt-5.3-codex',
        label: 'GPT-5.3 Codex',
        description: 'Coding-optimized model.',
        args: ['--model', 'gpt-5.3-codex'],
      },
      {
        id: 'gpt-5.3-codex-spark',
        label: 'Codex Spark',
        description: 'Ultra-fast coding model.',
        args: ['--model', 'gpt-5.3-codex-spark'],
      },
      {
        id: 'custom',
        label: 'Custom',
        description: 'Enter a custom model string accepted by Codex CLI.',
        custom: true,
      },
    ],
    defaultRuntime: 'localProcessing',
    runtimeModes: [
      {
        id: 'localProcessing',
        label: 'Process locally',
        summaryLabel: 'Local mode',
        description: 'Keep Codex work on this machine.',
      },
      {
        id: 'codexWeb',
        label: 'Connect Codex web',
        description: 'Open Codex web connection settings.',
        actionOnly: true,
        external: true,
      },
      {
        id: 'sendCloud',
        label: 'Send to cloud',
        description: 'Cloud handoff is not available in this extension yet.',
        disabled: true,
      },
      {
        id: 'quota',
        label: 'Remaining quota',
        description: 'View remaining Codex web quota.',
        actionOnly: true,
        dividerBefore: true,
      },
    ],
    defaultPermissionMode: 'workspaceWrite',
    permissionModes: [
      {
        id: 'readOnly',
        label: 'Read Only',
        description: 'Codex can inspect but cannot edit files.',
        instruction:
          'Codex read-only permission: inspect the workspace and propose concrete changes without editing files or running write commands.',
        args: ['--sandbox', 'read-only'],
      },
      {
        id: 'workspaceWrite',
        label: 'Workspace',
        description: 'Codex can edit files inside the workspace sandbox.',
        instruction:
          'Codex workspace permission: make scoped workspace edits when requested, then report verification clearly.',
        args: ['--sandbox', 'workspace-write'],
      },
      {
        id: 'fullAuto',
        label: 'Full Auto',
        description: 'Codex low-friction sandboxed automatic execution.',
        instruction:
          'Codex full-auto permission: work autonomously in the sandbox, keep changes scoped, and summarize commands, edits, and verification.',
        args: ['--full-auto'],
      },
      {
        id: 'danger',
        label: 'Danger',
        description: 'Bypass Codex approvals and sandbox. Use only in externally sandboxed environments.',
        instruction:
          'Codex danger permission: approvals and sandbox are bypassed. Keep edits scoped and call out risky operations explicitly.',
        args: ['--dangerously-bypass-approvals-and-sandbox'],
        dangerous: true,
      },
    ],
    defaultAgentMode: 'build',
    agentModes: [
      {
        id: 'build',
        label: 'Build',
        description: 'Implementation-focused Codex workflow.',
        instruction:
          'Codex build workflow: implement requested changes when allowed by the selected permission mode, then report verification clearly.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning-focused Codex workflow.',
        instruction:
          'Codex plan workflow: inspect the workspace and propose concrete steps before making changes.',
      },
      {
        id: 'review',
        label: 'Review',
        description: 'Codex review-focused workflow.',
        instruction:
          'Codex review workflow: lead with findings, risks, and missing tests before summary.',
      },
    ],
    installHint: 'npm install -g @openai/codex',
    installed: false,
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Terminal-native coding agent for fast codebase operations.',
    command: 'opencode',
    contextWindowTokens: 128000,
    autoCompactsContext: true,
    promptArgs: ['run', '--format', 'json', '--thinking'],
    backgroundServer: {
      args: ['serve', '--hostname', '127.0.0.1', '--port', '{port}'],
      attachArgs: ['--attach', 'http://127.0.0.1:{port}', '--dir', '{cwd}'],
      url: 'http://127.0.0.1:{port}',
      portRange: { start: 46100, size: 200 },
    },
    inputMode: 'argument',
    accent: '#a855f7',
    icon: 'O',
    capabilities: ['agent', 'terminal', 'workspace'],
    slashCommands: OPENCODE_SLASH_COMMANDS,
    taskRouting: {
      planning: 2,
      implementation: 4,
      review: 2,
      tests: 3,
      refactor: 3,
      explain: 2,
    },
    defaultModel: 'configured',
    customModelArgPrefix: ['--model'],
    modelOptions: [
      {
        id: 'configured',
        label: 'Configured',
        summaryLabel: 'Configured',
        description: 'Use the concrete model configured in OpenCode when model discovery is unavailable.',
      },
      {
        id: 'custom',
        label: 'Custom',
        description: 'Enter a provider/model string accepted by OpenCode.',
        custom: true,
      },
    ],
    defaultAgentMode: 'build',
    env: {
      OPENCODE_DB: '{tmp}/agents-gui-opencode-{cwdHash}.db',
      OMO_DISABLE_POSTHOG: '1',
      OMO_SEND_ANONYMOUS_TELEMETRY: '0',
    },
    agentModes: [
      {
        id: 'build',
        label: 'build',
        description: 'OpenCode build mode.',
        instruction:
          'OpenCode build mode: use the provider-native build workflow configured by OpenCode.',
      },
      {
        id: 'plan',
        label: 'plan',
        description: 'OpenCode plan mode.',
        instruction:
          'OpenCode plan mode: inspect the workspace and propose a plan before making changes.',
      },
    ],
    installHint: 'brew install opencode-ai/tap/opencode',
    installed: false,
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Automation-oriented agent for tool-using development tasks.',
    command: 'goose',
    promptArgs: ['run', '--no-session', '--quiet', '--output-format', 'text', '--text'],
    inputMode: 'argument',
    accent: '#f97316',
    icon: '⌂',
    capabilities: ['agent', 'automation', 'tools'],
    taskRouting: {
      planning: 2,
      implementation: 3,
      review: 1,
      tests: 3,
      refactor: 1,
      explain: 1,
    },
    defaultAgentMode: 'auto',
    agentModes: [
      {
        id: 'auto',
        label: 'Auto',
        description: 'Goose automation-oriented agent.',
        instruction:
          'Goose auto mode: automate the requested development task and keep the user informed about tool actions.',
      },
      {
        id: 'plan',
        label: 'Plan',
        description: 'Planning-only Goose workflow.',
        instruction:
          'Goose plan mode: inspect and outline a plan before automation or file changes.',
      },
    ],
    installHint: 'curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash',
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
    taskRouting: {
      planning: 1,
      implementation: 4,
      review: 2,
      tests: 5,
      refactor: 4,
      explain: 1,
    },
    defaultAgentMode: 'edit',
    agentModes: [
      {
        id: 'edit',
        label: 'Edit',
        description: 'Aider patch-oriented workflow.',
        instruction:
          'Aider edit mode: focus on precise patch generation and explain changed files.',
      },
      {
        id: 'architect',
        label: 'Architect',
        description: 'Aider planning and design workflow.',
        instruction:
          'Aider architect mode: reason about the change first and keep implementation guidance structured.',
      },
    ],
    installHint: 'pip install aider-install && aider-install',
    installed: false,
  },
];

export function getCliProfile(id: string): CliProfile | undefined {
  return CLI_PROFILES.find((p) => p.id === id);
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

export function getCliModelOption(profile: CliProfile, modelId?: string): CliModelOption {
  const options = profile.modelOptions ?? [];
  return (
    options.find((option) => option.id === modelId) ??
    options.find((option) => option.id === profile.defaultModel) ??
    options[0] ??
    { id: 'default', label: 'Default', description: 'Use provider default model.' }
  );
}

export function getCliRuntimeMode(profile: CliProfile, runtimeId?: string): CliRuntimeMode {
  const modes = profile.runtimeModes ?? [];
  const selectableModes = modes.filter(isSelectableProfileOption);
  return (
    selectableModes.find((mode) => mode.id === runtimeId) ??
    selectableModes.find((mode) => mode.id === profile.defaultRuntime) ??
    selectableModes[0] ??
    modes[0] ??
    { id: 'default', label: 'Default', description: 'Use provider default runtime.' }
  );
}

function isSelectableProfileOption(option: CliProfileOption): boolean {
  return !option.disabled && !option.actionOnly;
}

export function getCliPermissionMode(
  profile: CliProfile,
  permissionModeId?: string
): CliPermissionMode {
  const modes = profile.permissionModes ?? [];
  return (
    modes.find((mode) => mode.id === permissionModeId) ??
    modes.find((mode) => mode.id === profile.defaultPermissionMode) ??
    modes[0] ??
    { id: 'default', label: 'Default', description: 'Use provider default permissions.' }
  );
}

export function buildCliOptionArgs(
  profile: CliProfile,
  selection: CliOptionSelection = {}
): string[] {
  const runtime = getCliRuntimeMode(profile, selection.runtime);
  const model = getCliModelOption(profile, selection.model);
  const permission = getCliPermissionMode(profile, selection.permissionMode);
  const customModel = selection.customModel?.trim();
  const modelArgs =
    model.custom && customModel && profile.customModelArgPrefix
      ? [...profile.customModelArgPrefix, customModel]
      : model.args ?? [];

  return [
    ...(runtime.args ?? []),
    ...modelArgs,
    ...(permission.args ?? []),
  ];
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
  if (!modelId) {
    return undefined;
  }

  const [provider, ...rest] = modelId.split('/');
  const modelName = rest.join('/') || modelId;

  if (provider === 'openai' || provider === 'azure') {
    return { provider: 'openai', encoding: 'o200k_base', label: 'OpenAI o200k' };
  }

  if (provider === 'anthropic') {
    return { provider: 'anthropic', label: 'Claude tokenizer' };
  }

  if (provider === 'google' || provider === 'gemini') {
    return { provider: 'openai', encoding: 'cl100k_base', label: 'SentencePiece (approx)' };
  }

  if (modelName.includes('gpt-') || modelName.includes('o3') || modelName.includes('o4')) {
    return { provider: 'openai', encoding: 'o200k_base', label: 'OpenAI o200k' };
  }

  if (modelName.includes('claude')) {
    return { provider: 'anthropic', label: 'Claude tokenizer' };
  }

  return { provider: 'openai', encoding: 'o200k_base', label: 'o200k (default)' };
}

export function inferContextWindowTokens(modelId: string | undefined): number | undefined {
  if (!modelId) {
    return undefined;
  }

  const [provider, ...rest] = modelId.split('/');
  const modelName = rest.join('/') || modelId;

  if (provider === 'openai' || provider === 'azure') {
    return OPENAI_CONTEXT_WINDOW_TOKENS[modelName] ?? 128000;
  }

  if (provider === 'anthropic') {
    return ANTHROPIC_CONTEXT_WINDOW_TOKENS[modelName] ?? 200000;
  }

  return undefined;
}
