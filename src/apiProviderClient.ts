import * as http from 'http';
import * as https from 'https';
import type { ApiProviderProtocol } from './apiProviders';

export interface ApiProviderModelListRequest {
  protocol: ApiProviderProtocol;
  baseUrl: string;
  apiKey?: string;
}

const API_PROVIDER_MODELS_TIMEOUT_MS = 15_000;

export class ApiProviderClient {
  async listModels(request: ApiProviderModelListRequest): Promise<string[]> {
    const endpoint = `${request.baseUrl.replace(/\/+$/, '')}/models`;
    const headers: Record<string, string> = {
      accept: 'application/json',
    };

    if (request.apiKey) {
      if (request.protocol === 'anthropic') {
        headers['x-api-key'] = request.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers.authorization = `Bearer ${request.apiKey}`;
      }
    }

    const response = await requestJson(endpoint, headers);
    return extractModelIds(response);
  }
}

function requestJson(urlText: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlText);
    } catch {
      reject(new Error('Invalid Base URL'));
      return;
    }

    const client = url.protocol === 'http:' ? http : https;
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error('Base URL must start with http:// or https://'));
      return;
    }

    const request = client.request(
      url,
      {
        method: 'GET',
        headers,
        timeout: API_PROVIDER_MODELS_TIMEOUT_MS,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Models request failed: HTTP ${response.statusCode || 'unknown'}`));
            return;
          }
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch {
            reject(new Error('Models response is not valid JSON'));
          }
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error('Models request timed out'));
    });
    request.on('error', reject);
    request.end();
  });
}

function extractModelIds(value: unknown): string[] {
  const items = modelSourceArray(value);
  const seen = new Set<string>();
  const result: string[] = [];
  items.forEach((item) => {
    const id = modelIdFromItem(item);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    result.push(id);
  });
  return result.sort((a, b) => a.localeCompare(b));
}

function modelSourceArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) {
    return (value as { data: unknown[] }).data;
  }
  if (value && typeof value === 'object' && Array.isArray((value as { models?: unknown }).models)) {
    return (value as { models: unknown[] }).models;
  }
  return [];
}

function modelIdFromItem(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    ? record.id.trim()
    : typeof record.name === 'string'
      ? record.name.trim()
      : '';
}
