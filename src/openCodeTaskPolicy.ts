export type OpenCodeTaskEnvironment = Record<string, string>;

export function buildOpenCodeFastGenerationEnv(
  baseEnv: Readonly<Record<string, string>>,
  globalConfig: unknown
): OpenCodeTaskEnvironment {
  const inlineConfig = parseInlineConfig(baseEnv.OPENCODE_CONFIG_CONTENT);
  const inlineMcp = asRecord(inlineConfig.mcp);
  const globalMcp = asRecord(asRecord(globalConfig).mcp);
  const mcpNames = new Set([...Object.keys(globalMcp), ...Object.keys(inlineMcp)]);
  const disabledMcp: Record<string, Record<string, unknown>> = {};

  for (const name of mcpNames) {
    disabledMcp[name] = {
      ...asRecord(inlineMcp[name]),
      enabled: false,
    };
  }

  return {
    ...baseEnv,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      ...inlineConfig,
      mcp: disabledMcp,
      permission: { '*': 'deny' },
      plugin: [],
    }),
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_PURE: '1',
    OPENCODE_DISABLE_AUTOUPDATE: '1',
    OPENCODE_DISABLE_AUTOCOMPACT: '1',
    OPENCODE_DISABLE_MODELS_FETCH: '1',
  };
}

function parseInlineConfig(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) {
    return {};
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
