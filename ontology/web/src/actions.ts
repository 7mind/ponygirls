import * as C from './contracts.js';

export function actionKey(value: C.ReviewAction): string {
  return JSON.stringify(C.ReviewAction.jsonCodec().encode(C.BaboonCodecContext.Default, value));
}

export function selectionLabel(value: C.PresentedSelection): string {
  if (value instanceof C.PresentedSelection_Alternative) {
    return `Alternative ${value.index + 1}: ${value.label} · definition ${value.definition.id}@${value.definition.revision} · target ${value.target.id}@${value.target.revision}`;
  }
  return `Presented target ${value.target.id}@${value.target.revision}`;
}

export function actionLabel(value: C.ReviewAction): string {
  if (value instanceof C.ReviewAction_Review) return value.kind;
  if (value instanceof C.ReviewAction_Choose) return `Choose · ${selectionLabel(value.selection)}`;
  return `Adopt · ${value.target.id}@${value.target.revision}`;
}
