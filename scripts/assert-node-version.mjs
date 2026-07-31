#!/usr/bin/env node
import { assertSupportedNodeVersion } from './node-version-policy.mjs';

try {
  assertSupportedNodeVersion();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
