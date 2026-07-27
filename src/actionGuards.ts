import { AssistantActionId } from './assistantTypes';

const SELECTION_ACTIONS = new Set<AssistantActionId>(['explainSelection', 'refactorSelection']);

const ACTIVE_FILE_ACTIONS = new Set<AssistantActionId>(['reviewFile']);

export function actionRequiresSelection(action: AssistantActionId): boolean {
  return SELECTION_ACTIONS.has(action);
}

export function actionRequiresActiveFile(action: AssistantActionId): boolean {
  return ACTIVE_FILE_ACTIONS.has(action);
}
