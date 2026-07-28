import { execFileSync } from 'child_process';
import * as path from 'path';

export interface SystemProxyOptions {
  platform?: NodeJS.Platform;
  readMacProxy?: () => string;
  readWindowsInternetSettings?: () => string;
}

export function getSystemProxyEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env,
  options: SystemProxyOptions = {}
): Record<string, string> {
  if (hasProxyEnv(sourceEnv)) {
    return withLoopbackNoProxy(sourceEnv);
  }

  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') {
    const output = (options.readMacProxy ?? readScutilProxy)();
    return output ? parseMacSystemProxyEnv(output) : {};
  }
  if (platform === 'win32') {
    const output = (options.readWindowsInternetSettings ?? (() => readWindowsInternetSettings(sourceEnv)))();
    return output ? parseWindowsInternetSettings(output) : {};
  }
  return {};
}

function hasProxyEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env.HTTP_PROXY ||
    env.HTTPS_PROXY ||
    env.ALL_PROXY ||
    env.http_proxy ||
    env.https_proxy ||
    env.all_proxy
  );
}

export function parseMacSystemProxyEnv(output: string): Record<string, string> {
  const env: Record<string, string> = {};
  const httpProxy = readProxyUrl(output, 'HTTP', 'http');
  const httpsProxy = readProxyUrl(output, 'HTTPS', 'http');
  const socksProxy = readProxyUrl(output, 'SOCKS', 'socks5');

  if (httpProxy) {
    env.HTTP_PROXY = httpProxy;
    env.http_proxy = httpProxy;
  }
  if (httpsProxy) {
    env.HTTPS_PROXY = httpsProxy;
    env.https_proxy = httpsProxy;
  }
  if (socksProxy) {
    env.ALL_PROXY = socksProxy;
    env.all_proxy = socksProxy;
  }

  const noProxy = readNoProxy(output);
  if (noProxy) {
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
  }

  return env;
}

function readScutilProxy(): string {
  try {
    return execFileSync('/usr/sbin/scutil', ['--proxy'], {
      encoding: 'utf8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function readWindowsInternetSettings(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    return '';
  }

  try {
    return execFileSync(
      path.win32.join(systemRoot, 'System32', 'reg.exe'),
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      {
        encoding: 'utf8',
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      }
    );
  } catch {
    return '';
  }
}

export function parseWindowsInternetSettings(output: string): Record<string, string> {
  const values = readWindowsRegistryValues(output);
  if (values.ProxyEnable !== '0x1' && values.ProxyEnable !== '1') {
    return {};
  }

  const proxyServer = values.ProxyServer?.trim();
  if (!proxyServer) {
    return {};
  }

  const env: Record<string, string> = {};
  const protocolEntries = Object.fromEntries(
    proxyServer
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const separator = entry.indexOf('=');
        return [entry.slice(0, separator).toLowerCase(), entry.slice(separator + 1).trim()];
      })
  );

  if (Object.keys(protocolEntries).length === 0) {
    assignProxy(env, 'HTTP_PROXY', withScheme(proxyServer, 'http'));
    assignProxy(env, 'HTTPS_PROXY', withScheme(proxyServer, 'http'));
  } else {
    assignProxy(env, 'HTTP_PROXY', withScheme(protocolEntries.http, 'http'));
    assignProxy(env, 'HTTPS_PROXY', withScheme(protocolEntries.https, 'http'));
    assignProxy(env, 'ALL_PROXY', withScheme(protocolEntries.socks, 'socks5'));
  }

  if (Object.keys(env).length === 0) {
    return {};
  }

  const noProxy = normalizeWindowsProxyOverride(values.ProxyOverride || '');
  env.NO_PROXY = noProxy;
  env.no_proxy = noProxy;
  return env;
}

function readWindowsRegistryValues(output: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const match of output.matchAll(
    /^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_[A-Z_]+\s+(.+?)\s*$/gim
  )) {
    values[match[1]] = match[2].trim();
  }
  return values;
}

function assignProxy(
  env: Record<string, string>,
  upperName: 'HTTP_PROXY' | 'HTTPS_PROXY' | 'ALL_PROXY',
  value: string
): void {
  if (!value) {
    return;
  }
  env[upperName] = value;
  env[upperName.toLowerCase()] = value;
}

function withScheme(value: string | undefined, scheme: 'http' | 'socks5'): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.includes(';')) {
    return '';
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`;
}

function withLoopbackNoProxy(sourceEnv: NodeJS.ProcessEnv): Record<string, string> {
  const defaults = ['localhost', '127.0.0.1', '.local'];
  const entries = [sourceEnv.NO_PROXY, sourceEnv.no_proxy]
    .flatMap((value) => String(value || '').split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const noProxy = [...new Set([...entries, ...defaults])].join(',');
  return { NO_PROXY: noProxy, no_proxy: noProxy };
}

function normalizeWindowsProxyOverride(value: string): string {
  const defaults = ['localhost', '127.0.0.1', '.local'];
  const entries = value
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry && entry.toLowerCase() !== '<local>')
    .map((entry) => (entry.startsWith('*.') ? entry.slice(1) : entry));
  return [...new Set([...defaults, ...entries])].join(',');
}

function readProxyUrl(
  output: string,
  prefix: 'HTTP' | 'HTTPS' | 'SOCKS',
  scheme: 'http' | 'socks5'
): string {
  const enabled = readScutilValue(output, `${prefix}Enable`);
  const host = readScutilValue(output, `${prefix}Proxy`);
  const port = readScutilValue(output, `${prefix}Port`);
  return enabled === '1' && host && port ? `${scheme}://${host}:${port}` : '';
}

function readNoProxy(output: string): string {
  const exceptions = [...output.matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gm)]
    .map((match) => match[1]?.trim())
    .filter(Boolean);
  const defaults = ['127.0.0.1', 'localhost', '.local'];
  return [...new Set([...exceptions, ...defaults])].join(',');
}

function readScutilValue(output: string, key: string): string {
  const match = output.match(new RegExp(`^\\s*${escapeRegExp(key)}\\s*:\\s*(.+?)\\s*$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
