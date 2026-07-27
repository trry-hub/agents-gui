import { execFileSync } from 'child_process';

let cachedProxyEnv: Record<string, string> | undefined;

export function getSystemProxyEnv(
  sourceEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  if (hasProxyEnv(sourceEnv) || process.platform !== 'darwin') {
    return {};
  }

  cachedProxyEnv ??= readMacSystemProxyEnv();
  return cachedProxyEnv;
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

function readMacSystemProxyEnv(): Record<string, string> {
  const output = readScutilProxy();
  if (!output) {
    return {};
  }

  return parseMacSystemProxyEnv(output);
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
