import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const root = process.cwd();
const assetManifest = JSON.parse(
  fs.readFileSync(path.join(root, 'media', 'webview-assets.json'), 'utf8')
);

const steps = [
  {
    label: 'webview build and asset manifest',
    command: npmCommand,
    args: ['run', 'build'],
    verifyAssets: true,
  },
  {
    label: 'unit and architecture tests',
    command: npmCommand,
    args: ['run', 'test', '--', '--runInBand'],
  },
  {
    label: 'Extension Development Host smoke',
    command: npmCommand,
    args: ['run', 'smoke:extension'],
  },
  {
    label: 'standalone webview preview',
    command: npmCommand,
    args: ['run', 'preview:webview'],
  },
  {
    label: 'dependency audit',
    command: npmCommand,
    args: ['audit', '--omit=optional'],
  },
  {
    label: 'VSIX package',
    command: npmCommand,
    args: ['run', 'package'],
  },
  {
    label: 'working tree whitespace check',
    command: 'git',
    args: ['diff', '--check'],
  },
  {
    label: 'staged whitespace check',
    command: 'git',
    args: ['diff', '--cached', '--check'],
  },
];

for (const step of steps) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  if (step.verifyAssets) {
    verifyWebviewAssets();
  }
}

console.log('\nRelease verification passed.');

function verifyWebviewAssets() {
  const htmlPath = path.join(root, 'media', assetManifest.html);
  const html = fs.readFileSync(htmlPath, 'utf8');
  const placeholders = new Set(html.match(/__[A-Z0-9_]+_URI__/g) ?? []);
  const listed = new Set(
    assetManifest.assets.map((asset) => asset.placeholder)
  );
  assertSameSet(placeholders, listed, 'webview URI placeholders');

  for (const file of [
    assetManifest.html,
    ...assetManifest.assets.map((asset) => asset.path),
    ...Object.values(assetManifest.providerIcons).flatMap((icon) => [
      icon.light,
      icon.dark,
    ]),
    ...assetManifest.static,
  ]) {
    if (!fs.existsSync(path.join(root, 'media', file))) {
      throw new Error(`Missing webview asset: media/${file}`);
    }
  }
}

function assertSameSet(actual, expected, label) {
  const missing = [...actual].filter((value) => !expected.has(value));
  const extra = [...expected].filter((value) => !actual.has(value));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} mismatch; missing=${missing.join(',')}; extra=${extra.join(',')}`
    );
  }
}
