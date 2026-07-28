import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { resolveOpenCodePaths } from './openCodePaths';

const execFileAsync = promisify(execFile);

export type McpTransport = 'local' | 'remote';

export type McpCliId = 'claude' | 'codex' | 'gemini' | 'opencode';

export const MCP_CLI_IDS: McpCliId[] = ['claude', 'codex', 'gemini', 'opencode'];

export interface McpEnabledByCli {
  claude: boolean;
  codex: boolean;
  gemini: boolean;
  opencode: boolean;
}

export interface McpServerConfig {
  name: string;
  type: McpTransport;
  command?: string[];
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  environment?: Record<string, string>;
  enabled: boolean;
  enabledByCli?: McpEnabledByCli;
  description?: string;
  homepage?: string;
  docs?: string;
  tags?: string[];
}

export interface McpRuntimeStatus {
  status: 'connected' | 'failed' | 'disabled' | 'needs_auth' | 'unknown';
  error?: string;
}

export interface McpProfileStatus extends McpServerConfig {
  runtimeStatus: McpRuntimeStatus;
}

export interface CliMcpAdapter {
  readonly cliId: string;
  readonly supported: boolean;
  readonly configPath: string;
  readonly reason?: string;
  isAvailable?(): Promise<boolean>;
  list(): Promise<McpServerConfig[]>;
  upsert(server: McpServerConfig): Promise<void>;
  remove(name: string): Promise<void>;
  setEnabled(name: string, enabled: boolean): Promise<void>;
}

const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MCP_NAME_MAX_LENGTH = 64;
const SQLITE_TIMEOUT_MS = 8000;

export class McpConfigError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'mcp_config_error'
  ) {
    super(message);
    this.name = 'McpConfigError';
  }
}

export function validateMcpServerName(name: string): string | undefined {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return 'Name is required';
  }
  if (trimmed.length > MCP_NAME_MAX_LENGTH) {
    return `Name must be ${MCP_NAME_MAX_LENGTH} characters or fewer`;
  }
  if (!MCP_NAME_PATTERN.test(trimmed)) {
    return 'Name may only contain letters, digits, underscore and hyphen';
  }
  return undefined;
}

export function sanitizeMcpServerConfig(
  input: Partial<McpServerConfig> | undefined
): McpServerConfig | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }

  const name = String(input.name || '').trim();
  if (!name || validateMcpServerName(name)) {
    return undefined;
  }

  const type: McpTransport = input.type === 'remote' ? 'remote' : 'local';
  const environment = sanitizeStringRecord(input.environment);
  const headers = sanitizeStringRecord(input.headers);
  const enabledByCli = normalizeEnabledByCli(input.enabledByCli);
  const enabled = input.enabled !== false;

  if (type === 'remote') {
    const url = String(input.url || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return undefined;
    }
    return { name, type, url, headers, environment, enabled, enabledByCli };
  }

  const rawCommand = Array.isArray(input.command) ? input.command : [];
  const command = rawCommand.map((item) => String(item || '').trim()).filter(Boolean);
  if (command.length === 0) {
    return undefined;
  }

  const rawArgs = Array.isArray(input.args) ? input.args : [];
  const args = rawArgs.map((item) => String(item || '').trim()).filter(Boolean);

  return {
    name,
    type,
    command,
    args: args.length > 0 ? args : undefined,
    headers,
    environment,
    enabled,
    enabledByCli,
  };
}

export function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const result: Record<string, string> = {};
  let hasKeys = false;
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>)) {
    if (typeof rawValue !== 'string') {
      continue;
    }
    const trimmedKey = String(key).trim();
    const trimmedValue = rawValue.trim();
    if (!trimmedKey) {
      continue;
    }
    result[trimmedKey] = trimmedValue;
    hasKeys = true;
  }

  return hasKeys ? result : undefined;
}

export function normalizeEnabledByCli(value: unknown): McpEnabledByCli {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    claude: record.claude !== false,
    codex: record.codex !== false,
    gemini: record.gemini !== false,
    opencode: record.opencode !== false,
  };
}

function sqlEscape(value: string): string {
  return String(value || '').replace(/'/g, "''");
}

function ccSwitchDbPath(): string {
  return path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
}

function openCodeConfigPath(): string {
  return resolveOpenCodePaths().configPath;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const result = value
    .map((item) => (typeof item === 'string' ? item : String(item ?? '')))
    .map((item) => item.trim())
    .filter(Boolean);
  return result.length > 0 ? result : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const object = asObject(value);
  const result: Record<string, string> = {};
  let hasKeys = false;
  for (const [key, rawValue] of Object.entries(object)) {
    if (typeof rawValue !== 'string') {
      continue;
    }
    const trimmedKey = key.trim();
    const trimmedValue = rawValue.trim();
    if (!trimmedKey) {
      continue;
    }
    result[trimmedKey] = trimmedValue;
    hasKeys = true;
  }
  return hasKeys ? result : undefined;
}

function readJsonFile(filePath: string, fallback: unknown): unknown {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      return fallback;
    }
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const backupPath = `${filePath}.bak`;
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;

  try {
    if (fs.existsSync(filePath)) {
      const existing = await fs.promises.readFile(filePath, 'utf8');
      if (existing.trim()) {
        await fs.promises.writeFile(backupPath, existing, 'utf8');
      }
    }
    await fs.promises.writeFile(tmpPath, body, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(tmpPath)) {
        await fs.promises.unlink(tmpPath);
      }
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

function toOpenCodeEntry(server: McpServerConfig): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    enabled: server.enabledByCli?.opencode !== false && server.enabled !== false,
  };

  if (server.type === 'remote') {
    entry.type = 'remote';
    entry.url = server.url;
    if (server.headers) {
      entry.headers = server.headers;
    }
  } else {
    entry.type = 'local';
    const fullCommand = [...(server.command || []), ...(server.args || [])];
    entry.command = fullCommand;
  }

  if (server.environment) {
    entry.environment = server.environment;
  }

  return entry;
}

function toCcSwitchServerConfig(server: McpServerConfig): Record<string, unknown> {
  if (server.type === 'remote') {
    const config: Record<string, unknown> = {
      type: 'http',
      url: server.url,
    };
    if (server.headers) {
      config.headers = server.headers;
    }
    return config;
  }

  const config: Record<string, unknown> = { type: 'stdio' };
  const command = Array.isArray(server.command) ? server.command : [];
  if (command.length > 0) {
    config.command = command[0];
  }
  const args = [...command.slice(1), ...(Array.isArray(server.args) ? server.args : [])];
  if (args.length > 0) {
    config.args = args;
  }
  if (server.environment) {
    config.env = server.environment;
  }
  return config;
}

function fromCcSwitchServerConfig(
  id: string,
  serverConfigJson: string,
  enabledByCli: McpEnabledByCli
): McpServerConfig | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(serverConfigJson);
  } catch {
    return undefined;
  }
  const config = asObject(raw);
  const type = config.type === 'http' || config.type === 'sse' ? 'remote' : 'local';
  const environment = asStringRecord(config.env ?? config.environment);
  const headers = asStringRecord(config.headers);

  if (type === 'remote') {
    const url = typeof config.url === 'string' ? config.url.trim() : '';
    if (!url) {
      return undefined;
    }
    return {
      name: id,
      type: 'remote',
      url,
      headers,
      environment,
      enabled: enabledByCli.opencode,
      enabledByCli,
    };
  }

  const commandField =
    typeof config.command === 'string' ? [config.command] : asStringArray(config.command);
  const argsField = asStringArray(config.args) || [];
  const fullCommand = [...(commandField || []), ...argsField];
  if (fullCommand.length === 0) {
    return undefined;
  }

  return {
    name: id,
    type: 'local',
    command: fullCommand,
    headers,
    environment,
    enabled: enabledByCli.opencode,
    enabledByCli,
  };
}

interface CcSwitchMcpRow {
  id: string;
  name: string;
  server_config: string;
  description: string | null;
  homepage: string | null;
  docs: string | null;
  tags: string;
  enabled_claude: number;
  enabled_codex: number;
  enabled_gemini: number;
  enabled_opencode: number;
}

function rowToServerConfig(row: CcSwitchMcpRow): McpServerConfig | undefined {
  const enabledByCli: McpEnabledByCli = {
    claude: row.enabled_claude === 1,
    codex: row.enabled_codex === 1,
    gemini: row.enabled_gemini === 1,
    opencode: row.enabled_opencode === 1,
  };

  const server = fromCcSwitchServerConfig(row.id, row.server_config, enabledByCli);
  if (!server) {
    return undefined;
  }

  let tags: string[] | undefined;
  try {
    const parsed = JSON.parse(row.tags || '[]');
    if (Array.isArray(parsed)) {
      tags = parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch {
    // ignore malformed tags
  }

  return {
    ...server,
    description: row.description || undefined,
    homepage: row.homepage || undefined,
    docs: row.docs || undefined,
    tags,
  };
}

async function sqliteQuery(dbPath: string, sql: string): Promise<CcSwitchMcpRow[]> {
  try {
    const { stdout } = await execFileAsync('sqlite3', ['-json', dbPath, sql], {
      timeout: SQLITE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (!stdout.trim()) {
      return [];
    }
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? (parsed as CcSwitchMcpRow[]) : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpConfigError(`SQLite query failed: ${message}`, 'mcp_sqlite_read_failed');
  }
}

async function sqliteExecute(dbPath: string, sql: string): Promise<void> {
  try {
    await execFileAsync('sqlite3', [dbPath, sql], {
      timeout: SQLITE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new McpConfigError(`SQLite write failed: ${message}`, 'mcp_sqlite_write_failed');
  }
}

async function isCcSwitchAvailable(): Promise<boolean> {
  const dbPath = ccSwitchDbPath();
  if (!fs.existsSync(dbPath)) {
    return false;
  }
  try {
    await sqliteQuery(dbPath, 'SELECT COUNT(*) as count FROM mcp_servers LIMIT 1');
    return true;
  } catch {
    return false;
  }
}

async function readAllCcSwitchServers(): Promise<McpServerConfig[]> {
  const rows = await sqliteQuery(
    ccSwitchDbPath(),
    'SELECT id, name, server_config, description, homepage, docs, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode FROM mcp_servers ORDER BY id'
  );
  const servers: McpServerConfig[] = [];
  for (const row of rows) {
    const server = rowToServerConfig(row);
    if (server) {
      servers.push(server);
    }
  }
  return servers;
}

async function syncOpenCodeConfig(
  servers: McpServerConfig[],
  options: { removeNames?: string[] } = {}
): Promise<void> {
  const configPath = openCodeConfigPath();
  const raw = readJsonFile(configPath, {});
  const config = asObject(raw);
  const existingMcp = asObject(config.mcp);

  const merged: Record<string, unknown> = { ...existingMcp };
  for (const name of options.removeNames || []) {
    const normalized = String(name || '').trim();
    if (normalized) {
      delete merged[normalized];
    }
  }
  for (const server of servers) {
    merged[server.name] = toOpenCodeEntry(server);
  }

  config.mcp = merged;
  await writeJsonFileAtomic(configPath, config);
}

export class CcSwitchMcpAdapter implements CliMcpAdapter {
  readonly cliId = 'opencode';
  readonly supported = true;
  readonly configPath = ccSwitchDbPath();

  async isAvailable(): Promise<boolean> {
    return isCcSwitchAvailable();
  }

  async list(): Promise<McpServerConfig[]> {
    if (!(await isCcSwitchAvailable())) {
      return [];
    }
    return readAllCcSwitchServers();
  }

  async upsert(server: McpServerConfig): Promise<void> {
    const cleaned = sanitizeMcpServerConfig(server);
    if (!cleaned) {
      throw new McpConfigError('Invalid MCP server configuration', 'mcp_invalid');
    }

    const existing = await this.list();
    const prior = existing.find((item) => item.name === cleaned.name);
    const description = server.description ?? prior?.description ?? '';
    const homepage = server.homepage ?? prior?.homepage ?? '';
    const docs = server.docs ?? prior?.docs ?? '';
    const tags = JSON.stringify(server.tags ?? prior?.tags ?? []);
    const enabledByCli = cleaned.enabledByCli ??
      prior?.enabledByCli ?? {
        claude: true,
        codex: true,
        gemini: true,
        opencode: cleaned.enabled !== false,
      };

    const serverConfig = JSON.stringify(toCcSwitchServerConfig(cleaned));

    const sql = [
      'INSERT OR REPLACE INTO mcp_servers',
      '(id, name, server_config, description, homepage, docs, tags, enabled_claude, enabled_codex, enabled_gemini, enabled_opencode)',
      'VALUES (',
      `'${sqlEscape(cleaned.name)}',`,
      `'${sqlEscape(cleaned.name)}',`,
      `'${sqlEscape(serverConfig)}',`,
      `'${sqlEscape(description)}',`,
      `'${sqlEscape(homepage)}',`,
      `'${sqlEscape(docs)}',`,
      `'${sqlEscape(tags)}',`,
      enabledByCli.claude ? '1,' : '0,',
      enabledByCli.codex ? '1,' : '0,',
      enabledByCli.gemini ? '1,' : '0,',
      enabledByCli.opencode ? '1' : '0',
      ')',
    ].join(' ');

    await sqliteExecute(ccSwitchDbPath(), sql);
    const updated = await readAllCcSwitchServers();
    await syncOpenCodeConfig(updated);
  }

  async remove(name: string): Promise<void> {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return;
    }
    const sql = `DELETE FROM mcp_servers WHERE id = '${sqlEscape(normalizedName)}'`;
    await sqliteExecute(ccSwitchDbPath(), sql);
    const updated = await readAllCcSwitchServers();
    await syncOpenCodeConfig(updated, { removeNames: [normalizedName] });
  }

  async setEnabled(name: string, enabled: boolean): Promise<void> {
    const normalizedName = String(name || '').trim();
    if (!normalizedName) {
      return;
    }
    const value = enabled ? 1 : 0;
    const sql = `UPDATE mcp_servers SET enabled_opencode = ${value} WHERE id = '${sqlEscape(normalizedName)}'`;
    await sqliteExecute(ccSwitchDbPath(), sql);
    const updated = await readAllCcSwitchServers();
    await syncOpenCodeConfig(updated);
  }
}

export class UnsupportedMcpAdapter implements CliMcpAdapter {
  readonly supported = false;

  constructor(
    public readonly cliId: string,
    public readonly configPath: string,
    public readonly reason: string
  ) {}

  async list(): Promise<McpServerConfig[]> {
    return [];
  }

  async upsert(): Promise<void> {
    throw new McpConfigError(
      `MCP management is not supported for ${this.cliId}`,
      'mcp_unsupported'
    );
  }

  async remove(): Promise<void> {
    throw new McpConfigError(
      `MCP management is not supported for ${this.cliId}`,
      'mcp_unsupported'
    );
  }

  async setEnabled(): Promise<void> {
    throw new McpConfigError(
      `MCP management is not supported for ${this.cliId}`,
      'mcp_unsupported'
    );
  }
}

const ADAPTERS = new Map<string, CliMcpAdapter>();
let defaultCcSwitchAdapter: CcSwitchMcpAdapter | undefined;

export function registerMcpAdapter(adapter: CliMcpAdapter): void {
  ADAPTERS.set(adapter.cliId, adapter);
}

export function getMcpAdapter(cliId: string): CliMcpAdapter {
  const existing = ADAPTERS.get(cliId);
  if (existing) {
    return existing;
  }

  if (cliId === 'opencode') {
    if (!defaultCcSwitchAdapter) {
      defaultCcSwitchAdapter = new CcSwitchMcpAdapter();
    }
    return defaultCcSwitchAdapter;
  }

  const fallback = new UnsupportedMcpAdapter(
    cliId,
    '',
    `${cliId} does not expose an MCP config that Agents GUI can manage yet`
  );
  ADAPTERS.set(cliId, fallback);
  return fallback;
}

export function snapshotMcpConfigPath(cliId: string): string | undefined {
  try {
    return getMcpAdapter(cliId).configPath || undefined;
  } catch {
    return undefined;
  }
}

export {
  ccSwitchDbPath,
  openCodeConfigPath,
  isCcSwitchAvailable,
  readAllCcSwitchServers,
  syncOpenCodeConfig,
  sqlEscape,
};
