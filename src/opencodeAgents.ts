import type { CliAgentMode, CliModelOption } from './cliProfiles';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function parseOpenCodeAgentListOutput(output: string): CliAgentMode[] {
  const seen = new Set<string>();
  const modes: CliAgentMode[] = [];

  for (const line of output.split(/\r?\n/)) {
    const mode = parseOpenCodeAgentListLine(line);
    if (!mode || seen.has(mode.id)) {
      continue;
    }

    seen.add(mode.id);
    modes.push(mode);
  }

  return modes;
}

export interface OpenCodeAgentDiscovery {
  modes: CliAgentMode[];
  defaultAgentId?: string;
  defaultModelId?: string;
}

export interface OpenCodeModelSelection {
  providerID: string;
  modelID: string;
}

export function parseOpenCodeConfigAgents(config: unknown): OpenCodeAgentDiscovery {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { modes: [] };
  }

  const record = config as Record<string, unknown>;
  const defaultAgentId = pickString(record.default_agent);
  const agents = record.agent;
  if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
    return {
      modes: [],
      defaultAgentId,
      defaultModelId: pickString(record.model),
    };
  }

  const modes: CliAgentMode[] = [];
  let defaultAgentModel: string | undefined;
  for (const [id, value] of Object.entries(agents as Record<string, unknown>)) {
    const agent = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    const role = agent.mode === 'primary' || agent.mode === 'subagent'
      ? agent.mode
      : 'primary';
    if (role !== 'primary' || isInternalOpenCodeAgent(id)) {
      continue;
    }

    modes.push(createOpenCodeAgentMode(id, pickString(agent.description)));
    if (id === defaultAgentId) {
      defaultAgentModel = pickString(agent.model);
    }
  }

  return {
    modes,
    defaultAgentId,
    defaultModelId: pickString(record.model) ?? defaultAgentModel,
  };
}

export function parseOpenCodeDebugConfigOutput(output: string): OpenCodeAgentDiscovery {
  const defaultAgentId = parseJsonStringCapture(
    /^\s*"default_agent"\s*:\s*"((?:\\.|[^"\\])*)"/m.exec(output)?.[1]
  );
  const topLevelModelId = parseJsonStringCapture(
    /^  "model"\s*:\s*"((?:\\.|[^"\\])*)"/m.exec(output)?.[1]
  );
  const modes: CliAgentMode[] = [];
  let defaultAgentModelId: string | undefined;
  let inAgentBlock = false;
  let current:
    | {
        id: string;
        role: 'primary' | 'subagent';
        description?: string;
        modelId?: string;
      }
    | undefined;

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    if (current.role === 'primary') {
      modes.push(createOpenCodeAgentMode(current.id, current.description));
    }
    if (current.id === defaultAgentId) {
      defaultAgentModelId = current.modelId;
    }
    current = undefined;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_PATTERN, '');
    if (!inAgentBlock) {
      if (/^  "agent"\s*:\s*\{/.test(line)) {
        inAgentBlock = true;
      }
      continue;
    }

    if (/^  \}/.test(line)) {
      pushCurrent();
      break;
    }

    const agentMatch = /^    "((?:\\.|[^"\\])*)"\s*:\s*\{/.exec(line);
    if (agentMatch) {
      pushCurrent();
      const id = parseJsonStringCapture(agentMatch[1]);
      if (id && !isInternalOpenCodeAgent(id)) {
        current = { id, role: 'primary' };
      }
      continue;
    }

    if (!current) {
      continue;
    }

    const modeMatch = /^\s+"mode"\s*:\s*"(primary|subagent)"/.exec(line);
    if (modeMatch) {
      current.role = modeMatch[1] as 'primary' | 'subagent';
      continue;
    }

    const descriptionMatch = /^\s+"description"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(line);
    if (descriptionMatch) {
      current.description = parseJsonStringCapture(descriptionMatch[1]);
      continue;
    }

    const modelMatch = /^\s+"model"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(line);
    if (modelMatch) {
      current.modelId = parseJsonStringCapture(modelMatch[1]);
    }
  }

  return { modes, defaultAgentId, defaultModelId: topLevelModelId ?? defaultAgentModelId };
}

export function parseOpenCodeModelsOutput(output: string): CliModelOption[] {
  const seen = new Set<string>();
  const options: CliModelOption[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const cleaned = rawLine.replace(ANSI_PATTERN, '').trim();
    const modelId = /^([a-zA-Z0-9_.-]+\/[^\s]+)$/.exec(cleaned)?.[1];
    if (!modelId || seen.has(modelId)) {
      continue;
    }

    seen.add(modelId);
    options.push(createOpenCodeModelOption(modelId));
  }

  return options;
}

export function parseOpenCodeProviderModels(payload: unknown): CliModelOption[] {
  if (Array.isArray(payload)) {
    return parseOpenCodeModelArray(payload);
  }

  const record = objectRecord(payload);
  const providers = Array.isArray(record.providers)
    ? record.providers
    : Array.isArray(record.all)
      ? record.all
      : [];
  const options: CliModelOption[] = [];
  const seen = new Set<string>();

  for (const providerValue of providers) {
    const provider = objectRecord(providerValue);
    const providerId = pickString(provider.id);
    if (!providerId) {
      continue;
    }

    const providerName = pickString(provider.name);
    const models = objectRecord(provider.models);
    for (const [modelKey, modelValue] of Object.entries(models)) {
      const model = objectRecord(modelValue);
      const modelId = pickString(model.id) ?? modelKey;
      const fullId = `${providerId}/${modelId}`;
      if (seen.has(fullId)) {
        continue;
      }

      seen.add(fullId);
      options.push(createOpenCodeModelOption(
        fullId,
        pickString(model.name) ?? undefined,
        providerName
      ));
    }
  }

  return options;
}

export function parseOpenCodeModelId(modelId: string | undefined): OpenCodeModelSelection | undefined {
  if (!modelId || modelId === 'default' || modelId === 'custom') {
    return undefined;
  }

  const [providerID, ...modelParts] = modelId.split('/');
  const modelName = modelParts.join('/');
  if (!providerID || !modelName) {
    return undefined;
  }

  return { providerID, modelID: modelName };
}

export function parseOpenCodeAgentListLine(line: string): CliAgentMode | undefined {
  const cleaned = line.replace(ANSI_PATTERN, '').trim();
  const match = /^(.+?)\s+\((primary|subagent)\)$/.exec(cleaned);
  if (!match) {
    return undefined;
  }

  const id = match[1].trim();
  if (!id) {
    return undefined;
  }

  if (match[2] !== 'primary' || isInternalOpenCodeAgent(id)) {
    return undefined;
  }

  return createOpenCodeAgentMode(id);
}

function createOpenCodeAgentMode(
  id: string,
  description?: string
): CliAgentMode {
  const label = titleCaseAgentLabel(id.replace(/[\u200B\uFEFF]/g, '').trim() || id);
  return {
    id,
    label,
    description: truncateDescription(description) ?? 'OpenCode primary agent from the local CLI configuration.',
    instruction:
      `OpenCode ${label} agent: use the provider-native agent behavior configured by OpenCode.`,
    args: ['--agent', id],
  };
}

function isInternalOpenCodeAgent(id: string): boolean {
  const normalized = id.replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
  return normalized === 'title' || normalized === 'summary' || normalized === 'compaction';
}

function parseOpenCodeModelArray(models: unknown[]): CliModelOption[] {
  const options: CliModelOption[] = [];
  const seen = new Set<string>();
  for (const value of models) {
    const model = objectRecord(value);
    const providerId = pickString(model.providerID);
    const modelId = pickString(model.id);
    if (!providerId || !modelId) {
      continue;
    }

    const fullId = `${providerId}/${modelId}`;
    if (seen.has(fullId)) {
      continue;
    }

    seen.add(fullId);
    options.push(createOpenCodeModelOption(fullId, pickString(model.name) ?? undefined));
  }
  return options;
}

function createOpenCodeModelOption(
  id: string,
  label?: string,
  providerName?: string
): CliModelOption {
  const [provider, ...modelParts] = id.split('/');
  const modelName = modelParts.join('/') || id;
  return {
    id,
    label: label ?? id,
    summaryLabel: modelName,
    description: `OpenCode model from ${providerName || provider || 'configured provider'}; passed as --model ${id}.`,
    args: ['--model', id],
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function pickString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseJsonStringCapture(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(`"${value}"`);
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : undefined;
  } catch {
    return value.trim() || undefined;
  }
}

function truncateDescription(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const firstLine = value.replace(/\s+/g, ' ').trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}

function titleCaseAgentLabel(value: string): string {
  if (/[A-Z]/.test(value) || value.includes(' ')) {
    return value;
  }

  return value
    .split(/([_-]+)/)
    .map((part) => (/[_-]+/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}
