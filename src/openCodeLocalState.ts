import * as fs from 'fs';
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
}
