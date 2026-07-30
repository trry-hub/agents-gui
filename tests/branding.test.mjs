import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

test('release metadata declares native CLI passthrough version 0.0.20', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const runtimeArchitecture = readFileSync(
    new URL('../docs/architecture/agent-runtime.md', import.meta.url),
    'utf8'
  );
  const controlPlaneArchitecture = readFileSync(
    new URL('../docs/architecture/task-runtime-control-plane.md', import.meta.url),
    'utf8'
  );

  assert.equal(manifest.version, '0.0.20');
  assert.equal(lock.version, '0.0.20');
  assert.equal(lock.packages[''].version, '0.0.20');
  assert.match(changelog, /^## \[0\.0\.20\] - 2026-07-30$/m);
  assert.match(changelog, /__agents_gui_synced === true/);
  assert.match(changelog, /无带标记的\s*Provider 时不写入配置，也不创建备份/);

  const normalizeDocumentation = (content) => content.replace(/\s+/g, ' ');
  const contracts = [
    {
      name: 'README',
      content: normalizeDocumentation(readme),
      freshProcess: /每个用户请求和后续追问.*新的本机 CLI 进程.*上一轮对话.*文本.*下一次提示词/s,
      nativeLaunchClaims: [
        /系统安装的可执行文件/,
        /继承的 `PATH`/,
        /设置工作目录/,
        /原生单次提示词参数/,
      ],
      noOverrides: /不会.*自动切换.*受管的 OpenCode 后台服务.*任务策略.*覆盖层/s,
      observational: /显示.*仅用于观察.*不会向 CLI 注入.*模型.*Provider.*权限/s,
      migrationClaims: [
        /__agents_gui_synced === true.*备份.*匹配的顶层模型/s,
        /没有带标记的 Provider 时不写入配置，也不创建备份/s,
        /用户定义或未标记的配置都会保留/s,
      ],
    },
    {
      name: 'agent runtime architecture',
      content: normalizeDocumentation(runtimeArchitecture),
      freshProcess: /every user request and follow-up starts a fresh local CLI process[\s\S]*previous conversation[\s\S]*text[\s\S]*next prompt/i,
      nativeLaunchClaims: [
        /system-installed executable/i,
        /inherited `PATH`/i,
        /request `cwd`/i,
        /native one-shot prompt/i,
      ],
      noOverrides: /No automatic SCM or task fallback[\s\S]*No managed OpenCode server[\s\S]*no task-policy[\s\S]*fast-lane/i,
      observational: /Displayed model and context metadata is observational[\s\S]*not a model,[\s\S]*Provider,[\s\S]*runtime,[\s\S]*or permission override/i,
      migrationClaims: [
        /exact boolean `__agents_gui_synced === true`[\s\S]*backs up[\s\S]*matching top-level model/i,
        /no tagged Provider[\s\S]*no write[\s\S]*no backup/i,
        /user-defined or unmarked/i,
      ],
    },
    {
      name: 'task runtime architecture',
      content: normalizeDocumentation(controlPlaneArchitecture),
      freshProcess: /every user request and follow-up starts a fresh local CLI process[\s\S]*previous conversation[\s\S]*text[\s\S]*next prompt/i,
      nativeLaunchClaims: [
        /system installation/i,
        /inherited `PATH`/i,
        /working directory/i,
        /native one-shot prompt/i,
      ],
      noOverrides: /no automatic provider fallback[\s\S]*no managed OpenCode server[\s\S]*task-policy\/fast-lane configuration overlay/i,
      observational: /Configured model and context displays[\s\S]*observational[\s\S]*not an execution override/i,
      migrationClaims: [
        /exact boolean `__agents_gui_synced === true`[\s\S]*backs up[\s\S]*matching top-level model/i,
        /no tagged Provider[\s\S]*no write[\s\S]*no backup/i,
        /user-defined or unmarked/i,
      ],
    },
  ];

  for (const contract of contracts) {
    assert.match(contract.content, contract.freshProcess, `${contract.name} must document fresh processes`);
    for (const claim of contract.nativeLaunchClaims) {
      assert.match(contract.content, claim, `${contract.name} must document native launch`);
    }
    assert.match(contract.content, contract.noOverrides, `${contract.name} must reject overrides`);
    assert.match(contract.content, contract.observational, `${contract.name} must keep displays observational`);
    for (const claim of contract.migrationClaims) {
      assert.match(contract.content, claim, `${contract.name} must document narrow migration`);
    }
  }
});

test('README reports native prompt transport and only implemented tokenizers', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const expectedRows = [
    '| OpenCode | `opencode` | argument | 暂无 |',
    '| Codex CLI | `codex` | argument | OpenAI o200k |',
    '| Claude Code | `claude` | argument | Claude tokenizer |',
    '| Gemini CLI | `gemini` | argument | 暂无 |',
    '| Goose | `goose` | argument | 暂无 |',
    '| Aider | `aider` | argument | 暂无 |',
  ];

  for (const row of expectedRows) {
    assert.match(readme, new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(readme, /tiktoken cl100k|Anthropic tokens/);
});

test('release packaging uses an exact local VSCE dependency', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));

  assert.equal(manifest.devDependencies['@vscode/vsce'], '2.32.0');
  assert.equal(lock.packages[''].devDependencies['@vscode/vsce'], '2.32.0');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '2.32.0');
  assert.equal(manifest.scripts.package, 'npm run build && vsce package');
  assert.equal(
    manifest.scripts['publish:manual'],
    'npm run package && vsce publish --packagePath agents-gui-${npm_package_version}.vsix'
  );
  assert.doesNotMatch(JSON.stringify(manifest.scripts), /\bnpx\b/);
});

test('agents-gui uses the three-node mark as the global logo', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const html = readFileSync(new URL('../media/main.html', import.meta.url), 'utf8');
  const siteHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../media/main.css', import.meta.url), 'utf8');
  const iconPixels = readRgbaPng(new URL('../media/icon.png', import.meta.url));

  assert.equal(manifest.icon, 'media/icon.png');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].icon, 'media/icon.svg');
  assert.ok(existsSync(new URL('../media/icon.png', import.meta.url)));
  assert.ok(existsSync(new URL('../media/icon.svg', import.meta.url)));
  assert.equal(iconPixels.alphaAt(0, 0), 0);
  assert.ok(iconPixels.nonTransparentPixels > 0);
  assert.deepEqual(
    manifest.contributes.commands.find((command) => command.command === 'agents-gui.generateCommitMessage')?.icon,
    {
      light: 'media/commit-message-light.svg',
      dark: 'media/commit-message-dark.svg',
    }
  );
  assert.ok(existsSync(new URL('../media/commit-message-light.svg', import.meta.url)));
  assert.ok(existsSync(new URL('../media/commit-message-dark.svg', import.meta.url)));
  assert.match(html, /<symbol id="agents-gui-logo"/);
  assert.match(siteHtml, /<circle cx="6" cy="8" r="3"\/>/);
  assert.match(siteHtml, /<circle cx="18" cy="8" r="3"\/>/);
  assert.match(siteHtml, /<circle cx="12" cy="18" r="3"\/>/);
  assert.doesNotMatch(siteHtml, /<circle cx="7" cy="5\.5" r="2\.5"\/>/);
  assert.doesNotMatch(html, /<div class="toolbar-session">\s*<div class="brand-mark"/);
  assert.match(html, /<div class="brand-mark settings-brand-mark"[^>]*aria-label="Agents GUI"/);
  assert.match(css, /\.brand-mark\s*\{/);
  assert.match(css, /\.brand-logo\s*\{/);
  assert.match(css, /--assistant-foreground:\s*color-mix\(in srgb, var\(--vscode-foreground, #1f1f1f\) 82%, var\(--assistant-muted\)\);/);
  assert.match(css, /--assistant-surface:\s*#FAFAFD;/);
  assert.match(css, /body\.vscode-dark,\s*body\.vscode-high-contrast\s*\{\s*[^}]*--assistant-surface:\s*var\(--vscode-sideBar-background, var\(--vscode-editor-background, #1f1f1f\)\);/s);
  assert.match(css, /body\.vscode-dark,\s*body\.vscode-high-contrast\s*\{\s*[^}]*--assistant-foreground:\s*var\(--vscode-foreground, #d4d4d4\);/s);
  assert.match(css, /body\s*\{\s*[^}]*color:\s*var\(--assistant-foreground\);/s);
  assert.match(css, /\.message-content\s*\{\s*[^}]*color:\s*var\(--assistant-foreground\);/s);
});

test('SCM title command uses the Agents GUI mark as a toolbar-sized icon', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const commitCommand = manifest.contributes.commands.find((command) => command.command === 'agents-gui.generateCommitMessage');
  const lightIcon = readFileSync(new URL('../media/commit-message-light.svg', import.meta.url), 'utf8');
  const darkIcon = readFileSync(new URL('../media/commit-message-dark.svg', import.meta.url), 'utf8');

  assert.deepEqual(commitCommand.icon, {
    light: 'media/commit-message-light.svg',
    dark: 'media/commit-message-dark.svg',
  });
  assert.match(lightIcon, /width="16" height="16" viewBox="0 0 16 16"/);
  assert.match(darkIcon, /width="16" height="16" viewBox="0 0 16 16"/);
  assert.match(lightIcon, /<circle cx="4\.2" cy="5\.2"/);
  assert.match(lightIcon, /<circle cx="11\.8" cy="5\.2"/);
  assert.match(lightIcon, /<circle cx="8" cy="12"/);
});

function readRgbaPng(url) {
  const bytes = readFileSync(url);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.subarray(0, 8).equals(signature));

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    offset += 4;
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    offset += 4;
    const data = bytes.subarray(offset, offset + length);
    offset += length + 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  assert.equal(colorType, 6);
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(stride * height);
  let readOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    readOffset += 1;
    assert.equal(filter, 0);
    inflated.copy(pixels, y * stride, readOffset, readOffset + stride);
    readOffset += stride;
  }

  let nonTransparentPixels = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) {
      nonTransparentPixels += 1;
    }
  }

  return {
    nonTransparentPixels,
    alphaAt(x, y) {
      return pixels[(y * width + x) * 4 + 3];
    },
  };
}
