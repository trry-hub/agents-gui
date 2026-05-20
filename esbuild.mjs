import * as esbuild from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const watch = process.argv.includes('--watch');
const tiktokenWasmSource = 'node_modules/tiktoken/lite/tiktoken_bg.wasm';
const tiktokenWasmTarget = 'dist/tiktoken_bg.wasm';

async function copyRuntimeAssets() {
  await mkdir(dirname(tiktokenWasmTarget), { recursive: true });
  await copyFile(tiktokenWasmSource, tiktokenWasmTarget);
}

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
  plugins: [
    {
      name: 'copy-runtime-assets',
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) {
            await copyRuntimeAssets();
          }
        });
      },
    },
  ],
};

if (watch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(buildOptions);
  console.log('Build complete.');
}
