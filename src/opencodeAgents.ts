import type { CliAgentMode, CliConfiguredModel } from './cliProfiles';

const ANSI_PATTERN =
  // eslint-disable-next-line no-control-regex
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export interface OpenCodeAgentDiscovery {
  modes: CliAgentMode[];
  defaultAgentId?: string;
  defaultModelId?: string;
}

export function parseOpenCodeConfigAgents(config: unknown): OpenCodeAgentDiscovery {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { modes: [] };
  }

  const record = config as Record<string, unknown>;
  const defaultAgentId = pickString(record.default_agent);
  const defaultAgent = defaultAgentId
    ? objectRecord(objectRecord(record.agent)[defaultAgentId])
    : {};
  const modes = Object.entries(objectRecord(record.agent))
    .filter(([id, value]) => {
      const mode = pickString(objectRecord(value).mode) ?? 'primary';
      return mode === 'primary' && !isInternalOpenCodeAgent(id);
    })
    .map(([id, value]) => createOpenCodeAgentMode(id, pickString(objectRecord(value).description)));

  return {
    modes,
    defaultAgentId,
    defaultModelId: pickString(record.model, defaultAgent.model),
  };
}

export function parseOpenCodeDebugConfigOutput(output: string): OpenCodeAgentDiscovery {
  const defaultAgentId = parseJsonStringCapture(
    /^\s*"default_agent"\s*:\s*"((?:\\.|[^"\\])*)"/m.exec(output)?.[1]
  );
  const topLevelModelId = parseJsonStringCapture(
    /^ {2}"model"\s*:\s*"((?:\\.|[^"\\])*)"/m.exec(output)?.[1]
  );
  const modes: CliAgentMode[] = [];
  let inAgentBlock = false;
  let defaultAgentModelId: string | undefined;
  let current: { id: string; role: string; description?: string } | undefined;

  const pushCurrent = () => {
    if (current?.role === 'primary' && !isInternalOpenCodeAgent(current.id)) {
      modes.push(createOpenCodeAgentMode(current.id, current.description));
    }
    current = undefined;
  };

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.replace(ANSI_PATTERN, '');
    if (!inAgentBlock) {
      if (/^ {2}"agent"\s*:\s*\{/.test(line)) inAgentBlock = true;
      continue;
    }
    if (/^ {2}\}/.test(line)) {
      pushCurrent();
      break;
    }
    const agentMatch = /^ {4}"((?:\\.|[^"\\])*)"\s*:\s*\{/.exec(line);
    if (agentMatch) {
      pushCurrent();
      const id = parseJsonStringCapture(agentMatch[1]);
      if (id) current = { id, role: 'primary' };
      continue;
    }
    if (!current) continue;
    const modeMatch = /^\s+"mode"\s*:\s*"(primary|subagent)"/.exec(line);
    if (modeMatch) {
      current.role = modeMatch[1];
      continue;
    }
    const descriptionMatch = /^\s+"description"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(line);
    if (descriptionMatch) current.description = parseJsonStringCapture(descriptionMatch[1]);
    const modelMatch = /^ {6}"model"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(line);
    if (current.id === defaultAgentId && modelMatch) {
      defaultAgentModelId = parseJsonStringCapture(modelMatch[1]);
    }
  }

  return {
    modes,
    defaultAgentId,
    defaultModelId: topLevelModelId ?? defaultAgentModelId,
  };
}

export function parseOpenCodeModelsOutput(output: string): CliConfiguredModel[] {
  const seen = new Set<string>();
  const models: CliConfiguredModel[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const id = /^([a-zA-Z0-9_.-]+\/[^\s]+)$/.exec(rawLine.replace(ANSI_PATTERN, '').trim())?.[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      models.push({ id, label: id });
    }
  }
  return models;
}

function createOpenCodeAgentMode(id: string, description?: string): CliAgentMode {
  const label = id.replace(/[\u200B\uFEFF]/g, '').trim() || id;
  const detail = truncateDescription(description);
  return {
    id,
    label,
    description: detail
      ? `OpenCode CLI primary mode: ${label}. ${detail}`
      : `OpenCode CLI primary mode: ${label}.`,
    instruction: `OpenCode ${label} agent: use the provider-native agent behavior configured by OpenCode.`,
  };
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isInternalOpenCodeAgent(id: string): boolean {
  return ['title', 'summary', 'compaction'].includes(
    id
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .toLowerCase()
  );
}

function pickString(...values: unknown[]): string | undefined {
  return values
    .find((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    ?.trim();
}

function parseJsonStringCapture(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(`"${value}"`);
    return typeof parsed === 'string' && parsed.trim() ? parsed.trim() : undefined;
  } catch {
    return value.trim() || undefined;
  }
}

function truncateDescription(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const firstLine = value.replace(/\s+/g, ' ').trim();
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine;
}
