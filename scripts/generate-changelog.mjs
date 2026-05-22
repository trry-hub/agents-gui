#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const args = new Map();

function readJsonIfExists(fileName) {
  const filePath = path.join(root, fileName);
  if (!existsSync(filePath)) {
    return {};
  }

  return JSON.parse(readFileSync(filePath, 'utf8'));
}

const nls = {
  ...readJsonIfExists('package.nls.json'),
  ...readJsonIfExists('package.nls.zh-cn.json'),
};

function resolveNls(value) {
  const match = typeof value === 'string' ? value.match(/^%(.+)%$/) : undefined;
  if (!match) {
    return value;
  }

  return nls[match[1]] || value;
}

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) {
    continue;
  }

  const next = process.argv[i + 1];
  if (next && !next.startsWith('--')) {
    args.set(arg, next);
    i += 1;
  } else {
    args.set(arg, 'true');
  }
}

function git(gitArgs, options = {}) {
  const result = spawnSync('git', gitArgs, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      return '';
    }
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result.stdout.trim();
}

function hasRef(ref) {
  return spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
    cwd: root,
  }).status === 0;
}

function normalizeTag(input) {
  const value = (input || '').trim() || `v${pkg.version}`;
  return value.startsWith('v') ? value : `v${value}`;
}

function releaseDate() {
  return new Date().toISOString().slice(0, 10);
}

function parseCommit(line) {
  const [hash, subject] = line.split('\u001f');
  const match = subject.match(/^([a-zA-Z]+)(?:\([^)]+\))?:\s*(.+)$/);
  const type = match ? match[1].toLowerCase() : 'other';
  const title = match ? match[2] : subject;
  return {
    hash,
    shortHash: hash.slice(0, 7),
    subject,
    title,
    type,
  };
}

const typeLabels = [
  ['feat', '新增'],
  ['fix', '修复'],
  ['perf', '性能'],
  ['refactor', '重构'],
  ['docs', '文档'],
  ['test', '测试'],
  ['build', '构建'],
  ['ci', '工作流'],
  ['chore', '维护'],
  ['style', '样式'],
  ['other', '其他'],
];

function groupCommits(commits) {
  const groups = new Map(typeLabels.map(([type]) => [type, []]));
  for (const commit of commits) {
    const key = groups.has(commit.type) ? commit.type : 'other';
    groups.get(key).push(commit);
  }
  return groups;
}

function renderCommitGroups(commits) {
  if (commits.length === 0) {
    return '- 本次范围内没有检测到 commit 变更。\n';
  }

  const groups = groupCommits(commits);
  const sections = [];

  for (const [type, label] of typeLabels) {
    const items = groups.get(type);
    if (!items || items.length === 0) {
      continue;
    }

    sections.push(`### ${label}`);
    sections.push('');
    for (const commit of items) {
      sections.push(`- ${commit.title} (${commit.shortHash})`);
    }
    sections.push('');
  }

  return `${sections.join('\n').trimEnd()}\n`;
}

function readCommits(rangeArgs) {
  const format = '%H%x1f%s';
  const output = git(['log', `--pretty=format:${format}`, ...rangeArgs], {
    allowFailure: true,
  });
  return output ? output.split('\n').map(parseCommit) : [];
}

function updateChangelog(filePath, releaseNotes, tag) {
  const absolute = path.resolve(root, filePath);
  const existing = existsSync(absolute)
    ? readFileSync(absolute, 'utf8')
    : '# 更新日志\n\n';
  const heading = `## ${tag}`;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const withoutCurrent = existing.replace(
    new RegExp(`\\n?${escaped}[^\\n]*\\n[\\s\\S]*?(?=\\n##\\s|$)`),
    '\n',
  ).trimEnd();

  const normalized = withoutCurrent.startsWith('#')
    ? withoutCurrent
    : '# 更新日志\n';
  const lines = normalized.trimEnd().split('\n');
  const title = lines.shift() || '# 更新日志';
  const previousEntries = lines.join('\n').trim();
  const content = previousEntries
    ? `${title}\n\n${releaseNotes}\n${previousEntries}\n`
    : `${title}\n\n${releaseNotes}`;
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content.endsWith('\n') ? content : `${content}\n`);
  console.log(`Wrote ${path.relative(root, absolute)}`);
}

function writeOutput(filePath, content) {
  if (!filePath) {
    return;
  }

  const absolute = path.resolve(root, filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  console.log(`Wrote ${path.relative(root, absolute)}`);
}

const tag = normalizeTag(args.get('--version') || process.env.GITHUB_REF_NAME);
const version = tag.replace(/^v/, '');
const toRef = args.get('--to') || (hasRef(tag) ? tag : 'HEAD');
const fromRef =
  args.get('--from') ||
  git(['describe', '--tags', '--abbrev=0', `${toRef}^`], { allowFailure: true });
const rangeArgs = fromRef ? [`${fromRef}..${toRef}`] : [toRef];
const commits = readCommits(rangeArgs);
const date = releaseDate();
const rangeLabel = fromRef ? `${fromRef}..${toRef}` : `initial history..${toRef}`;

const releaseNotes = [
  `## ${tag} - ${date}`,
  '',
  `Range: \`${rangeLabel}\``,
  '',
  renderCommitGroups(commits),
].join('\n').trimEnd() + '\n';

writeOutput(args.get('--release-notes'), releaseNotes);

if (args.get('--changelog')) {
  updateChangelog(args.get('--changelog'), releaseNotes, tag);
}

const docsDir = args.get('--docs-dir');
if (docsDir) {
  const absoluteDocs = path.resolve(root, docsDir);
  mkdirSync(absoluteDocs, { recursive: true });

  const changelog = [
    '# 更新日志',
    '',
    releaseNotes,
  ].join('\n').trimEnd() + '\n';

  writeFileSync(
    path.join(absoluteDocs, 'index.md'),
    [
      '# Agents GUI',
      '',
      resolveNls(pkg.description),
      '',
      `Latest release: **${tag}**`,
      '',
      '## 安装',
      '',
      '```bash',
      `code --install-extension agents-gui-${version}.vsix`,
      '```',
      '',
      '## 发布日志',
      '',
      '- [完整更新日志](./CHANGELOG.md)',
      '- [GitHub Release](https://github.com/trry-hub/agents-gui/releases)',
      '',
    ].join('\n'),
  );

  writeFileSync(path.join(absoluteDocs, 'CHANGELOG.md'), changelog);
  writeFileSync(path.join(absoluteDocs, '.nojekyll'), '');
  console.log(`Wrote ${path.relative(root, absoluteDocs)}`);
}
