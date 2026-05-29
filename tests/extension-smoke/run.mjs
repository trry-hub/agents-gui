import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests,
} from '@vscode/test-electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDevelopmentPath = path.resolve(__dirname, '../..');
const extensionTestsPath = path.join(__dirname, 'suite', 'index.js');
const appExecutablePath = await downloadAndUnzipVSCode({ extensionDevelopmentPath });
const vscodeExecutablePath =
  process.env.VSCODE_TEST_EXECUTABLE || resolveCliPathFromVSCodeExecutablePath(appExecutablePath);

await runTests({
  vscodeExecutablePath,
  extensionDevelopmentPath,
  extensionTestsPath,
});
