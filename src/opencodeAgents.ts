import type { CliAgentMode, CliModelOption } from './cliProfiles';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export interface OpenCodeAgentDiscovery {
  modes: CliAgentMode[];
  defaultAgentId?: string;
  defaultModelId?: string;
  modelBoundAgentIds?: string[];
}

export interface OpenCodeModelSelection {
  providerID: string;
  modelID: string;
}

export interface OpenCodeModelState {
  currentModelId?: string;
  currentVariant?: string;
  recentModelIds: string[];
  variants: Record<string, string>;
}

export interface OpenCodeModelMetadata {
  variantOptions?: string[];
}

export type OpenCodeModelMetadataMap = Record<string, OpenCodeModelMetadata>;

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
  const modelBoundAgentIds: string[] = [];
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

    const modelId = pickString(agent.model);
    if (modelId) {
      modelBoundAgentIds.push(id);
    } else {
      modes.push(createOpenCodeAgentMode(id, role, pickString(agent.description)));
    }
    if (id === defaultAgentId) {
      defaultAgentModel = modelId;
    }
  }

  return {
    modes,
    defaultAgentId,
    defaultModelId: pickString(record.model) ?? defaultAgentModel,
    modelBoundAgentIds,
  };
}

export function parseOpenCodeModelState(state: unknown): OpenCodeModelState {
  const record = objectRecord(state);
  const variants = parseOpenCodeVariantMap(record.variant);
  const explicitCurrent =
    openCodeModelSelectionId(record.current) ??
    openCodeModelSelectionId(record.model) ??
    pickString(record.currentModel, record.currentModelId, record.defaultModel);
  const recentModelIds = Array.isArray(record.recent)
    ? record.recent.map(openCodeModelSelectionId).filter(Boolean) as string[]
    : [];
  const currentModelId = explicitCurrent ?? recentModelIds[0];
  return {
    currentModelId,
    currentVariant: currentModelId ? variants[currentModelId] : undefined,
    recentModelIds,
    variants,
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
  const modelBoundAgentIds: string[] = [];
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
      if (current.modelId) {
        modelBoundAgentIds.push(current.id);
      } else {
        modes.push(createOpenCodeAgentMode(current.id, current.role, current.description));
      }
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

  return { modes, defaultAgentId, defaultModelId: topLevelModelId ?? defaultAgentModelId, modelBoundAgentIds };
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
        providerName,
        parseOpenCodeReasoningVariantOptions(model)
      ));
    }
  }

  return options;
}

export function parseOpenCodeModelMetadata(payload: unknown): OpenCodeModelMetadataMap {
  const result: OpenCodeModelMetadataMap = {};
  const providers = objectRecord(payload);
  for (const [providerKey, providerValue] of Object.entries(providers)) {
    const provider = objectRecord(providerValue);
    const providerId = pickString(provider.id) ?? pickString(providerKey);
    if (!providerId) {
      continue;
    }

    const models = objectRecord(provider.models);
    for (const [modelKey, modelValue] of Object.entries(models)) {
      const model = objectRecord(modelValue);
      const modelId = pickString(model.id) ?? pickString(modelKey);
      if (!modelId) {
        continue;
      }

      const variantOptions = parseOpenCodeReasoningVariantOptions(model);
      if (variantOptions.length > 0) {
        result[`${providerId}/${modelId}`] = { variantOptions };
      }
    }
  }
  return result;
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

function createOpenCodeAgentMode(
  id: string,
  role: 'primary' | 'subagent',
  description?: string
): CliAgentMode {
  const label = id.replace(/[\u200B\uFEFF]/g, '').trim() || id;
  const sourceDescription = `OpenCode CLI ${role} mode: ${label}.`;
  const agentDescription = truncateDescription(description);
  return {
    id,
    label,
    description: agentDescription ? `${sourceDescription} ${agentDescription}` : sourceDescription,
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
    options.push(createOpenCodeModelOption(
      fullId,
      pickString(model.name) ?? undefined,
      undefined,
      parseOpenCodeReasoningVariantOptions(model)
    ));
  }
  return options;
}

function createOpenCodeModelOption(
  id: string,
  label?: string,
  providerName?: string,
  variantOptions: string[] = []
): CliModelOption {
  const [provider, ...modelParts] = id.split('/');
  const modelName = modelParts.join('/') || id;
  const variantDescription = variantOptions.length > 0
    ? ` Supports OpenCode reasoning depth: ${variantOptions.join(', ')}.`
    : '';
  return {
    id,
    label: label ?? id,
    summaryLabel: modelName,
    description: `OpenCode model from ${providerName || provider || 'configured provider'}; passed as --model ${id}.${variantDescription}`,
    args: ['--model', id],
    ...(variantOptions.length > 0 ? { variantOptions } : {}),
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function openCodeModelSelectionId(value: unknown): string | undefined {
  const stringValue = pickString(value);
  if (stringValue) {
    return stringValue;
  }

  const record = objectRecord(value);
  const providerId = pickString(record.providerID, record.providerId, record.provider);
  const modelId = pickString(record.modelID, record.modelId, record.id, record.model);
  if (!providerId || !modelId) {
    return undefined;
  }

  return `${providerId}/${modelId}`;
}

function parseOpenCodeVariantMap(value: unknown): Record<string, string> {
  const variants: Record<string, string> = {};
  for (const [modelId, variant] of Object.entries(objectRecord(value))) {
    const cleanModelId = pickString(modelId);
    const cleanVariant = pickString(variant);
    if (cleanModelId && cleanVariant) {
      variants[cleanModelId] = cleanVariant;
    }
  }
  return variants;
}

function parseOpenCodeReasoningVariantOptions(model: Record<string, unknown>): string[] {
  if (model.reasoning !== true) {
    return [];
  }

  const reasoningOptions = Array.isArray(model.reasoning_options)
    ? model.reasoning_options
    : [];
  const effortOption = reasoningOptions
    .map(objectRecord)
    .find((option) => pickString(option.type) === 'effort');
  const values = Array.isArray(effortOption?.values) ? effortOption.values : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleanValue = pickString(value);
    if (!cleanValue || !/^[A-Za-z0-9_.-]+$/.test(cleanValue) || seen.has(cleanValue)) {
      continue;
    }

    seen.add(cleanValue);
    result.push(cleanValue);
  }
  return result;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
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
