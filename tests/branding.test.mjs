import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { inflateSync } from 'node:zlib';

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
