export const MINIMUM_NODE_VERSION = Object.freeze({
  major: 22,
  minor: 22,
  patch: 1,
});

export function parseNodeVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value || '').trim());
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function isSupportedNodeVersion(value) {
  const parsed = parseNodeVersion(value);
  if (!parsed) return false;
  if (parsed.major !== MINIMUM_NODE_VERSION.major) {
    return parsed.major > MINIMUM_NODE_VERSION.major;
  }
  if (parsed.minor !== MINIMUM_NODE_VERSION.minor) {
    return parsed.minor > MINIMUM_NODE_VERSION.minor;
  }
  return parsed.patch >= MINIMUM_NODE_VERSION.patch;
}

export function assertSupportedNodeVersion(value = process.versions.node) {
  if (!isSupportedNodeVersion(value)) {
    throw new Error(
      `Node.js 22.22.1 or newer is required for Agents GUI engineering tasks; current ${value}.`
    );
  }
}
