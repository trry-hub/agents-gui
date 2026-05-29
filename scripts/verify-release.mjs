import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const steps = [
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
}

console.log('\nRelease verification passed.');
