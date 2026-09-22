import type { AppPaths } from '../../paths';
import {
  loadModel,
  modelFilePath,
  refreshBlueprintModel,
  safeBlueprintFilePath,
  saveModel,
  type BlueprintModel,
} from '../blueprint';
import type { OpenProject } from '../types';

export interface ModelRefresh {
  model: BlueprintModel;
  changed: boolean;
}

/** Owns the location and refresh lifecycle of the persisted declaration model. */
export class BlueprintModelStore {
  constructor(private readonly paths: AppPaths) {}

  load(project: OpenProject): BlueprintModel {
    return loadModel(modelFilePath(this.paths, project.repository.id, project.blueprint.id));
  }

  save(project: OpenProject, model: BlueprintModel): void {
    saveModel(modelFilePath(this.paths, project.repository.id, project.blueprint.id), model);
  }

  declarationCount(repositoryId: number, blueprintId: string): number {
    return loadModel(modelFilePath(this.paths, repositoryId, blueprintId)).declarations.size;
  }

  refresh(project: OpenProject): ModelRefresh {
    const model = this.load(project);
    const changed = refreshBlueprintModel(
      model,
      project.clonePath,
      project.blueprint.id,
      project.blueprintFile,
      project.projectSubdir,
    );
    if (changed) this.save(project, model);
    return { model, changed };
  }

  /** Include missing targets so creating a referenced chapter triggers a refresh. */
  watchFiles(project: OpenProject, includedFiles: readonly string[], missingIncludes: readonly string[] = []): string[] {
    const files: string[] = [];
    for (const file of [project.blueprintFile, ...includedFiles, ...missingIncludes]) {
      const safe = safeBlueprintFilePath(file);
      if (safe && !files.includes(safe)) files.push(safe);
    }
    return files;
  }
}
