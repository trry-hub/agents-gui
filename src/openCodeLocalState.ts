import * as fs from 'fs';
import * as path from 'path';
import {
  parseOpenCodeModelMetadata,
  parseOpenCodeModelState,
  type OpenCodeModelMetadataMap,
  type OpenCodeModelState,
} from './opencodeAgents';
import { resolveOpenCodePaths, type OpenCodePathOptions } from './openCodePaths';

export interface OpenCodeLocalStatePaths {
  stateHome: string;
  cacheHome: string;
  modelStatePath: string;
  modelMetadataPath: string;
}

export type OpenCodeLocalStateOptions = OpenCodePathOptions;

export class OpenCodeLocalState {
  constructor(private readonly options: OpenCodeLocalStateOptions = {}) {}

  paths(): OpenCodeLocalStatePaths {
    const { stateHome, cacheHome, modelStatePath, modelMetadataPath } = resolveOpenCodePaths(
      this.options
    );
    return { stateHome, cacheHome, modelStatePath, modelMetadataPath };
  }

  readModelState(): OpenCodeModelState {
    try {
      return parseOpenCodeModelState(
        JSON.parse(fs.readFileSync(this.paths().modelStatePath, 'utf8'))
      );
    } catch {
      return { recentModelIds: [], variants: {} };
    }
  }

  readModelMetadata(): OpenCodeModelMetadataMap {
    try {
      return parseOpenCodeModelMetadata(
        JSON.parse(fs.readFileSync(this.paths().modelMetadataPath, 'utf8'))
      );
    } catch {
      return {};
    }
  }

  async updateModelVariant(modelId: string, variant: string): Promise<void> {
    const modelStatePath = this.paths().modelStatePath;
    const state = await this.readModelStateRecord(modelStatePath);
    const existingVariants =
      state.variant && typeof state.variant === 'object' && !Array.isArray(state.variant)
        ? (state.variant as Record<string, unknown>)
        : {};
    state.variant = {
      ...existingVariants,
      [modelId]: variant,
    };

    await fs.promises.mkdir(path.dirname(modelStatePath), { recursive: true });
    await fs.promises.writeFile(modelStatePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }

  private async readModelStateRecord(modelStatePath: string): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(modelStatePath, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

}
