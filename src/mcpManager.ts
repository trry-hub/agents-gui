import type { AssistantMcpServerStatus } from './assistantTypes';
import {
  McpConfigError,
  McpProfileStatus,
  McpRuntimeStatus,
  McpServerConfig,
  CcSwitchMcpAdapter,
  UnsupportedMcpAdapter,
  getMcpAdapter,
  registerMcpAdapter,
  sanitizeMcpServerConfig,
  validateMcpServerName,
} from './mcpConfig';

export interface McpManagerOptions {
  openCodeStatusProvider?: () => Promise<{ mcpServers?: AssistantMcpServerStatus[] } | undefined>;
}

export interface McpOperationResult {
  ok: boolean;
  message?: string;
  code?: string;
}

registerMcpAdapter(new CcSwitchMcpAdapter());

async function adapterIsAvailable(adapter: {
  isAvailable?: () => Promise<boolean>;
}): Promise<boolean> {
  return typeof adapter.isAvailable === 'function' ? adapter.isAvailable() : true;
}

function adapterUnavailableResult(cliId: string, configPath: string | undefined) {
  return {
    cliId,
    supported: false,
    configPath,
    servers: [],
    reason: 'MCP management requires an available cc-switch SQLite database for this agent.',
  };
}

function classifyRuntimeStatus(rawStatus: string | undefined): McpRuntimeStatus['status'] {
  const normalized = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (normalized === 'connected' || normalized === 'ready' || normalized === 'running') {
    return 'connected';
  }
  if (normalized === 'failed' || normalized === 'error') {
    return 'failed';
  }
  if (normalized === 'disabled' || normalized === 'off') {
    return 'disabled';
  }
  if (normalized.includes('auth')) {
    return 'needs_auth';
  }
  return 'unknown';
}

function runtimeStatusFromMcpStatus(entry: AssistantMcpServerStatus | undefined): McpRuntimeStatus {
  if (!entry) {
    return { status: 'unknown' };
  }
  return {
    status: classifyRuntimeStatus(entry.status),
    ...(entry.error ? { error: entry.error } : {}),
  };
}

export class McpManager {
  constructor(private readonly options: McpManagerOptions = {}) {}

  async snapshot(cliId: string) {
    const adapter = getMcpAdapter(cliId);
    if (!adapter.supported) {
      return {
        cliId,
        supported: false,
        configPath: adapter.configPath || undefined,
        servers: [],
        reason: (adapter as UnsupportedMcpAdapter).reason,
      };
    }
    if (!(await adapterIsAvailable(adapter))) {
      return adapterUnavailableResult(cliId, adapter.configPath || undefined);
    }

    const [servers, runtimeStatus] = await Promise.all([
      adapter.list().catch((error) => {
        throw error;
      }),
      this.fetchRuntimeStatus(cliId),
    ]);

    const statusByName = new Map<string, AssistantMcpServerStatus>();
    for (const entry of runtimeStatus) {
      statusByName.set(entry.name, entry);
    }

    const merged: McpProfileStatus[] = servers.map((server) => ({
      ...server,
      runtimeStatus: runtimeStatusFromMcpStatus(statusByName.get(server.name)),
    }));

    const orphanRuntimeEntries = runtimeStatus.filter(
      (entry) => !servers.some((server) => server.name === entry.name)
    );
    for (const orphan of orphanRuntimeEntries) {
      merged.push({
        name: orphan.name,
        type: 'local',
        command: [],
        enabled: true,
        runtimeStatus: runtimeStatusFromMcpStatus(orphan),
      });
    }

    merged.sort((a, b) => a.name.localeCompare(b.name));

    return {
      cliId,
      supported: true,
      configPath: adapter.configPath,
      reason: undefined,
      servers: merged,
    };
  }

  async upsert(cliId: string, server: Partial<McpServerConfig>): Promise<McpOperationResult> {
    const adapter = getMcpAdapter(cliId);
    if (!adapter.supported) {
      return {
        ok: false,
        message: adapter.reason || 'MCP management is not supported',
        code: 'mcp_unsupported',
      };
    }
    if (!(await adapterIsAvailable(adapter))) {
      return {
        ok: false,
        message: adapterUnavailableResult(cliId, adapter.configPath).reason,
        code: 'mcp_unavailable',
      };
    }

    const nameError = validateMcpServerName(server.name || '');
    if (nameError) {
      return { ok: false, message: nameError, code: 'mcp_invalid_name' };
    }

    const cleaned = sanitizeMcpServerConfig(server);
    if (!cleaned) {
      return { ok: false, message: 'MCP server configuration is incomplete.', code: 'mcp_invalid' };
    }

    try {
      await adapter.upsert(cleaned);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: this.errorMessage(error),
        code: error instanceof McpConfigError ? error.code : 'mcp_upsert_failed',
      };
    }
  }

  async remove(cliId: string, name: string): Promise<McpOperationResult> {
    const adapter = getMcpAdapter(cliId);
    if (!adapter.supported) {
      return {
        ok: false,
        message: adapter.reason || 'MCP management is not supported',
        code: 'mcp_unsupported',
      };
    }
    if (!(await adapterIsAvailable(adapter))) {
      return {
        ok: false,
        message: adapterUnavailableResult(cliId, adapter.configPath).reason,
        code: 'mcp_unavailable',
      };
    }
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      return { ok: false, message: 'MCP server name is required.', code: 'mcp_invalid_name' };
    }

    try {
      await adapter.remove(trimmed);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: this.errorMessage(error),
        code: error instanceof McpConfigError ? error.code : 'mcp_remove_failed',
      };
    }
  }

  async setEnabled(cliId: string, name: string, enabled: boolean): Promise<McpOperationResult> {
    const adapter = getMcpAdapter(cliId);
    if (!adapter.supported) {
      return {
        ok: false,
        message: adapter.reason || 'MCP management is not supported',
        code: 'mcp_unsupported',
      };
    }
    if (!(await adapterIsAvailable(adapter))) {
      return {
        ok: false,
        message: adapterUnavailableResult(cliId, adapter.configPath).reason,
        code: 'mcp_unavailable',
      };
    }
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      return { ok: false, message: 'MCP server name is required.', code: 'mcp_invalid_name' };
    }

    try {
      await adapter.setEnabled(trimmed, enabled);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: this.errorMessage(error),
        code: error instanceof McpConfigError ? error.code : 'mcp_toggle_failed',
      };
    }
  }

  private async fetchRuntimeStatus(cliId: string): Promise<AssistantMcpServerStatus[]> {
    if (cliId !== 'opencode') {
      return [];
    }
    try {
      const status = await this.options.openCodeStatusProvider?.();
      return Array.isArray(status?.mcpServers) ? status.mcpServers : [];
    } catch {
      return [];
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
}

export { McpConfigError, validateMcpServerName, sanitizeMcpServerConfig };
export type { McpServerConfig, McpProfileStatus, McpRuntimeStatus };
