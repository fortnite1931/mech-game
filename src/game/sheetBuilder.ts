import type { EventRow, ActionSpec, ConditionSpec } from './project.ts';
import { defaultValues } from './props.ts';
import { ACTION_BY_ID, CONDITION_BY_ID } from './sheets.ts';

/** Короткие конструкторы для читаемых листов событий. */
export function act(action: string, params: Record<string, string | number | boolean> = {}): ActionSpec {
  const def = ACTION_BY_ID.get(action);
  const base = def ? defaultValues(def.params) : {};
  return { action, params: { ...base, ...params } as ActionSpec['params'] };
}

export function cond(condition: string, params: Record<string, string | number | boolean> = {}): ConditionSpec {
  const def = CONDITION_BY_ID.get(condition);
  const base = def ? defaultValues(def.params) : {};
  return { condition, params: { ...base, ...params } as ConditionSpec['params'] };
}

let rowSeq = 0;
export function ev(event: string, then: ActionSpec[], opts: {
  comment?: string;
  condition?: ConditionSpec;
  else?: ActionSpec[];
  children?: EventRow[];
} = {}): EventRow {
  rowSeq += 1;
  return {
    id: `row_${Date.now().toString(36)}${rowSeq.toString(36)}`,
    event,
    comment: opts.comment,
    condition: opts.condition,
    then,
    else: opts.else ?? [],
    children: opts.children ?? [],
  };
}

export const B = 'then';
export const E = 'else';