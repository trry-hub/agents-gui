import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const extensionBuildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !watch,
};

const webviewBuildOptions = {
  entryPoints: ['src/webview/codexRenderer.tsx'],
  bundle: true,
  outfile: 'media/codex-renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  minify: !watch,
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(extensionBuildOptions),
    esbuild.context(webviewBuildOptions),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('Watching for changes...');
} else {
  await Promise.all([
    esbuild.build(extensionBuildOptions),
    esbuild.build(webviewBuildOptions),
  ]);
  console.log('Build complete.');
}
