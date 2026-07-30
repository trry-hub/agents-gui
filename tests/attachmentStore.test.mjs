import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const Module = require('node:module');
const originalLoad = Module._load;
const vscode = {
  FileType: { File: 1 },
  Uri: {
    joinPath(base, ...parts) {
      return { fsPath: [base.fsPath, ...parts].join('/') };
    },
  },
  workspace: {
    fs: {
      async createDirectory() {},
      async readDirectory() {
        return [];
      },
      async writeFile() {
        throw new Error('oversized attachment should not be written');
      },
    },
  },
};
Module._load = function (request, parent, isMain) {
  return request === 'vscode'
    ? vscode
    : originalLoad.call(this, request, parent, isMain);
};
const { ImageAttachmentStore } = require('../.test-dist/attachmentStore.js');
Module._load = originalLoad;

test('attachment store rejects oversized base64 before allocating its decoded buffer', async () => {
  const store = new ImageAttachmentStore({
    storageUri: { fsPath: '/storage' },
    maxAttachmentBytes: 4,
  });
  const originalBufferFrom = Buffer.from;
  Buffer.from = function (value, encoding, ...rest) {
    if (encoding === 'base64') {
      throw new Error('base64 decoder was invoked');
    }
    return originalBufferFrom.call(Buffer, value, encoding, ...rest);
  };
  try {
    assert.deepEqual(
      await store.materialize([
        {
          kind: 'image',
          name: 'oversized.png',
          mimeType: 'image/png',
          size: 1,
          dataUrl: `data:image/png;base64,${'A'.repeat(100)}`,
        },
      ]),
      []
    );
  } finally {
    Buffer.from = originalBufferFrom;
  }
});
