import * as path from 'path';
import * as vscode from 'vscode';
import type {
  AssistantImageAttachment,
  AssistantImageAttachmentInput,
} from './assistantTypes';

const DEFAULT_MAX_IMAGE_ATTACHMENTS = 8;
const DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024;
const DEFAULT_IMAGE_ATTACHMENT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_STORED_IMAGE_ATTACHMENTS = 128;

export interface ImageAttachmentStoreOptions {
  storageUri: vscode.Uri;
  maxAttachments?: number;
  maxAttachmentBytes?: number;
  retentionMs?: number;
  maxStoredAttachments?: number;
}

export class ImageAttachmentStore {
  private readonly maxAttachments: number;
  private readonly maxAttachmentBytes: number;
  private readonly retentionMs: number;
  private readonly maxStoredAttachments: number;

  constructor(private readonly options: ImageAttachmentStoreOptions) {
    this.maxAttachments = options.maxAttachments ?? DEFAULT_MAX_IMAGE_ATTACHMENTS;
    this.maxAttachmentBytes = options.maxAttachmentBytes ?? DEFAULT_MAX_IMAGE_ATTACHMENT_BYTES;
    this.retentionMs = options.retentionMs ?? DEFAULT_IMAGE_ATTACHMENT_RETENTION_MS;
    this.maxStoredAttachments = options.maxStoredAttachments ?? DEFAULT_MAX_STORED_IMAGE_ATTACHMENTS;
  }

  async materialize(inputs: AssistantImageAttachmentInput[] = []): Promise<AssistantImageAttachment[]> {
    const imageInputs = inputs
      .filter((input) => this.isImageAttachmentInput(input))
      .slice(0, this.maxAttachments);

    if (imageInputs.length === 0) {
      return [];
    }

    const attachmentDir = vscode.Uri.joinPath(this.options.storageUri, 'pasted-images');
    await vscode.workspace.fs.createDirectory(attachmentDir);
    await this.prune(attachmentDir);

    const attachments: AssistantImageAttachment[] = [];
    for (const input of imageInputs) {
      const decoded = this.decodeImageDataUrl(input.dataUrl, input.mimeType);
      if (!decoded) {
        continue;
      }

      const name = this.safeAttachmentName(input.name, decoded.mimeType, attachments.length);
      const fileName = `${Date.now()}-${attachments.length + 1}-${name}`;
      const uri = vscode.Uri.joinPath(attachmentDir, fileName);
      await vscode.workspace.fs.writeFile(uri, decoded.bytes);
      attachments.push({
        kind: 'image',
        name,
        mimeType: decoded.mimeType,
        size: decoded.bytes.byteLength,
        path: uri.fsPath,
      });
    }

    return attachments;
  }

  private async prune(attachmentDir: vscode.Uri): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(attachmentDir);
      const cutoff = Date.now() - this.retentionMs;
      const files: Array<{ uri: vscode.Uri; mtime: number }> = [];

      for (const [name, type] of entries) {
        if (type !== vscode.FileType.File) {
          continue;
        }

        const uri = vscode.Uri.joinPath(attachmentDir, name);
        try {
          const stat = await vscode.workspace.fs.stat(uri);
          if (stat.mtime < cutoff) {
            await vscode.workspace.fs.delete(uri, { useTrash: false });
            continue;
          }

          files.push({ uri, mtime: stat.mtime });
        } catch {
          // Best-effort cleanup must not block prompt submission.
        }
      }

      files.sort((a, b) => b.mtime - a.mtime);
      for (const stale of files.slice(this.maxStoredAttachments)) {
        await vscode.workspace.fs.delete(stale.uri, { useTrash: false });
      }
    } catch {
      // Best-effort cleanup must not block prompt submission.
    }
  }

  private isImageAttachmentInput(value: unknown): value is AssistantImageAttachmentInput {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const input = value as Partial<AssistantImageAttachmentInput>;
    return (
      input.kind === 'image' &&
      typeof input.name === 'string' &&
      typeof input.mimeType === 'string' &&
      input.mimeType.startsWith('image/') &&
      typeof input.dataUrl === 'string' &&
      input.dataUrl.startsWith('data:image/') &&
      Number(input.size) > 0 &&
      Number(input.size) <= this.maxAttachmentBytes
    );
  }

  private decodeImageDataUrl(
    dataUrl: string,
    expectedMimeType: string
  ): { mimeType: string; bytes: Uint8Array } | undefined {
    const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) {
      return undefined;
    }

    const mimeType = match[1] || expectedMimeType;
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.byteLength === 0 || bytes.byteLength > this.maxAttachmentBytes) {
      return undefined;
    }

    return { mimeType, bytes };
  }

  private safeAttachmentName(name: string, mimeType: string, index: number): string {
    const fallback = `pasted-image-${index + 1}${this.extensionForMime(mimeType)}`;
    const baseName = path.basename(String(name || fallback)).replace(/[^a-zA-Z0-9._-]/g, '-');
    const normalized = baseName.replace(/-+/g, '-').replace(/^\.+/, '').slice(0, 80);
    if (!normalized) {
      return fallback;
    }

    return /\.[a-zA-Z0-9]{2,5}$/.test(normalized)
      ? normalized
      : `${normalized}${this.extensionForMime(mimeType)}`;
  }

  private extensionForMime(mimeType: string): string {
    switch (mimeType.toLowerCase()) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      case 'image/gif':
        return '.gif';
      case 'image/svg+xml':
        return '.svg';
      case 'image/png':
      default:
        return '.png';
    }
  }
}
