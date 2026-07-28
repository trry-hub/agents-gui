import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  getSystemProxyEnv,
  parseMacSystemProxyEnv,
  parseWindowsInternetSettings,
} = require('../.test-dist/systemProxyEnv.js');

test('Windows single proxy populates HTTP and HTTPS variables', () => {
  const env = parseWindowsInternetSettings(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       proxy.example.com:8080
    ProxyOverride  REG_SZ       <local>;*.corp.example.com
  `);
  assert.equal(env.HTTP_PROXY, 'http://proxy.example.com:8080');
  assert.equal(env.HTTPS_PROXY, 'http://proxy.example.com:8080');
  assert.equal(env.http_proxy, env.HTTP_PROXY);
  assert.equal(env.https_proxy, env.HTTPS_PROXY);
  assert.equal(env.NO_PROXY, 'localhost,127.0.0.1,.local,.corp.example.com');
  assert.equal(env.no_proxy, env.NO_PROXY);
});

test('Windows protocol-specific proxy maps http https and socks independently', () => {
  const env = parseWindowsInternetSettings(`
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ       http=proxy:80;https=secure-proxy:443;socks=socks-proxy:1080
    ProxyOverride  REG_SZ       localhost;10.*
  `);
  assert.equal(env.HTTP_PROXY, 'http://proxy:80');
  assert.equal(env.HTTPS_PROXY, 'http://secure-proxy:443');
  assert.equal(env.ALL_PROXY, 'socks5://socks-proxy:1080');
  assert.match(env.NO_PROXY, /10\.\*/);
});

test('disabled or malformed Windows proxy settings are non-fatal', () => {
  assert.deepEqual(
    parseWindowsInternetSettings('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ proxy:80'),
    {}
  );
  assert.deepEqual(parseWindowsInternetSettings('not registry output'), {});
  for (const proxyServer of [';', 'foo=bar', 'http=;https=']) {
    assert.deepEqual(
      parseWindowsInternetSettings(
        `ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ ${proxyServer}\nProxyOverride REG_SZ <local>`
      ),
      {}
    );
  }
});

test('explicit proxy environment prevents registry lookup and preserves loopback bypasses', () => {
  let reads = 0;
  const env = getSystemProxyEnv(
    {
      HTTPS_PROXY: 'http://explicit:8443',
      NO_PROXY: 'internal.example.com,localhost',
      no_proxy: 'api.example.com,127.0.0.1',
    },
    {
      platform: 'win32',
      readWindowsInternetSettings() {
        reads += 1;
        return '';
      },
    }
  );
  assert.deepEqual(env, {
    NO_PROXY: 'internal.example.com,localhost,api.example.com,127.0.0.1,.local',
    no_proxy: 'internal.example.com,localhost,api.example.com,127.0.0.1,.local',
  });
  assert.equal(reads, 0);
});

test('macOS system proxy output maps to CLI proxy environment variables', () => {
  const env = parseMacSystemProxyEnv(`
<dictionary> {
  ExceptionsList : <array> {
    0 : 127.0.0.1
    1 : localhost
    2 : *.local
  }
  HTTPEnable : 1
  HTTPPort : 7897
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7897
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7897
  SOCKSProxy : 127.0.0.1
}
`);

  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(env.ALL_PROXY, 'socks5://127.0.0.1:7897');
  assert.match(env.NO_PROXY, /localhost/);
});
