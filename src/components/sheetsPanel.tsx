import { useState } from 'react';
import {
  ChevronRight, ChevronDown, Plus, Trash2, ArrowUp, ArrowDown, Pencil, ListTree, X, FileCode2,
} from 'lucide-react';
import { cn } from '../utils/cn.ts';
import type { ActionSpec, ConditionSpec, EventRow, EventSheet } from '../game/project.ts';
import {
  ACTION_BY_ID, ACTION_DEFS, CONDITION_BY_ID, CONDITION_DEFS, EVENT_BY_ID, EVENT_DEFS,
  describeParams, lineNumbers, newCondition, type EntryDef,
} from '../game/sheets.ts';
import { LogicWizard, SourcePicker } from './logicWizard.tsx';

interface SheetBridge {
  getSheets(): EventSheet[];
  createSheet(name: string, event?: string): EventSheet;
  renameSheet(id: string, name: string): boolean;
  deleteSheet(id: string): boolean;
  addRow(sheetId: string, event: string, parentRowId?: string): boolean;
  updateRow(sheetId: string, rowId: string, patch: Partial<EventRow>): boolean;
  deleteRow(sheetId: string, rowId: string): boolean;
  moveRowUp(sheetId: string, rowId: string): boolean;
  moveRowDown(sheetId: string, rowId: string): boolean;
  setCondition(sheetId: string, rowId: string, condition: ConditionSpec | undefined): boolean;
  addAction(sheetId: string, rowId: string, action: ActionSpec, branch?: 'then' | 'else'): boolean;
  updateAction(sheetId: string, rowId: string, index: number, patch: Partial<ActionSpec>, branch?: 'then' | 'else'): boolean;
  deleteAction(sheetId: string, rowId: string, index: number, branch?: 'then' | 'else'): boolean;
}

const COLOR_BADGE: Record<EntryDef['color'], string> = {
  event: 'bg-amber-500/25 text-amber-200 border-amber-500/40',
  object: 'bg-emerald-500/25 text-emerald-200 border-emerald-500/40',
  action: 'bg-sky-500/25 text-sky-200 border-sky-500/40',
  system: 'bg-stone-500/25 text-stone-200 border-stone-400/40',
};

function Badge({ def, text }: { def: EntryDef | undefined; text: string }) {
  return (
    <span className={cn(
      'flex shrink-0 items-center rounded-[3px] border px-1.5 py-0.5 text-[10px] font-bold',
      COLOR_BADGE[def?.color ?? 'system'],
    )}>
      {text}
    </span>
  );
}

function ParamEditor({ defs, values, onChange }: {
  defs: EntryDef['params']; values: Record<string, unknown>; onChange: (k: string, v: string | number | boolean) => void;
}) {
  return (
    <div className="mt-1 space-y-1 border-l border-white/10 pl-2">
      {defs.map((d) => {
        const v = values[d.key];
        if (d.kind === 'bool') {
          return (
            <label key={d.key} className="flex items-center gap-1.5 text-[10px] text-stone-400">
              <input type="checkbox" checked={v === true || v === 'true'} onChange={(e) => onChange(d.key, e.target.checked)} />
              {d.label}
            </label>
          );
        }
        if (d.kind === 'enum') {
          return (
            <div key={d.key} className="flex items-center gap-1.5">
              <span className="w-24 shrink-0 text-[10px] text-stone-500">{d.label}</span>
              <select
                value={String(v ?? d.def)}
                onChange={(e) => onChange(d.key, e.target.value)}
                className="rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 text-[10px] text-stone-200 focus:outline-none"
              >
                {d.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          );
        }
        return (
          <div key={d.key} className="flex items-center gap-1.5">
            <span className="w-24 shrink-0 text-[10px] text-stone-500">{d.label}</span>
            <input
              type={d.kind === 'number' ? 'number' : 'text'}
              value={String(v ?? d.def)}
              onChange={(e) => onChange(d.key, d.kind === 'number' ? Number(e.target.value) : e.target.value)}
              className="w-40 rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 font-mono text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}

export function SheetsPanel({ bridge, wide }: { bridge: SheetBridge | null; wide?: boolean }) {
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ kind: 'row' | 'cond' | 'action'; rowId: string; index?: number } | null>(null);
  const [wizard, setWizard] = useState<null | { kind: 'event' | 'condition' | 'action'; rowId?: string; branch?: 'then' | 'else'; source?: string }>(null);

  const sheets = bridge ? bridge.getSheets() : [];
  const current = sheets.find((s) => s.id === sheetId) ?? sheets[0] ?? null;

  if (!bridge) return <div className="p-3 text-[11px] text-stone-500">Движок запускается…</div>;
  if (!current) return <div className="p-3 text-[11px] text-stone-500">Листов событий пока нет.</div>;

  const lines = lineNumbers(current.rows ?? []);
  const maxLine = lines.length ? Math.max(...lines.map((l) => l.line)) + 2 : 1;

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const renderRow = (row: EventRow, line: number, depth: number) => {
    const isOpen = !collapsed.has(row.id);
    const evDef = EVENT_BY_ID.get(row.event);
    const editingThis = editing?.rowId === row.id;

    return (
      <div key={row.id} className={depth ? 'ml-4 border-l border-white/10 pl-2' : ''}>
        <div className="flex items-start gap-1.5 py-0.5">
          <span className="w-7 shrink-0 pt-1 text-right font-mono text-[10px] text-stone-600">{line}</span>
          <button
            onClick={() => toggle(row.id)}
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-amber-300"
          >
            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
          <div className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1',
            depth === 0 ? 'bg-white/[0.05] hover:bg-white/[0.08]' : 'bg-white/[0.03]',
          )}>
            <Badge def={evDef} text={evDef?.label ?? row.event} />
            {row.comment && <span className="truncate text-[10px] italic text-stone-500">// {row.comment}</span>}
            <div className="ml-auto flex items-center gap-0.5">
              <button title="Переименовать/заметка" onClick={() => setEditing(editingThis ? null : { kind: 'row', rowId: row.id })}
                className="text-stone-600 hover:text-amber-300"><Pencil size={10} /></button>
              <button title="Выше" onClick={() => bridge.moveRowUp(current.id, row.id)} className="text-stone-600 hover:text-amber-300"><ArrowUp size={10} /></button>
              <button title="Ниже" onClick={() => bridge.moveRowDown(current.id, row.id)} className="text-stone-600 hover:text-amber-300"><ArrowDown size={10} /></button>
              <button title="Удалить событие" onClick={() => bridge.deleteRow(current.id, row.id)} className="text-stone-600 hover:text-red-400"><Trash2 size={10} /></button>
            </div>
          </div>
        </div>

        {editingThis && editing?.kind === 'row' && (
          <div className="ml-9 mb-1 flex items-center gap-1.5">
            <select
              value={row.event}
              onChange={(e) => bridge.updateRow(current.id, row.id, { event: e.target.value })}
              className="rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 text-[10px] text-stone-200"
            >
              {EVENT_DEFS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <input
              value={row.comment ?? ''}
              onChange={(e) => bridge.updateRow(current.id, row.id, { comment: e.target.value })}
              placeholder="заметка для себя…"
              className="flex-1 rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 text-[10px] italic text-stone-300 placeholder:text-stone-600"
            />
          </div>
        )}

        {isOpen && (
          <div className="ml-9 space-y-1 pb-1">
            {!row.condition && (
              <button
                onClick={() => setWizard({ kind: 'condition', rowId: row.id })}
                className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-emerald-300"
              >
                <Plus size={10} /> Добавить условие
              </button>
            )}

            {row.condition && (
              <div className="rounded border border-emerald-500/25 bg-emerald-500/[0.05] p-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-emerald-400">◆</span>
                  <select
                    value={row.condition.condition}
                    onChange={(e) => bridge.setCondition(current.id, row.id, { condition: e.target.value, params: row.condition!.params })}
                    className="rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 text-[10px] text-stone-200"
                  >
                    {CONDITION_DEFS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                  <span className="truncate font-mono text-[10px] text-stone-400">{describeParams(row.condition.params)}</span>
                  <div className="ml-auto flex gap-0.5">
                    <button title="Параметры" onClick={() => setEditing(editing?.kind === 'cond' && editing.rowId === row.id ? null : { kind: 'cond', rowId: row.id })}
                      className="text-stone-600 hover:text-amber-300"><Pencil size={10} /></button>
                    <button title="Убрать условие" onClick={() => bridge.setCondition(current.id, row.id, undefined)}
                      className="text-stone-600 hover:text-red-400"><X size={10} /></button>
                  </div>
                </div>
                {editing?.kind === 'cond' && editing.rowId === row.id && (
                  <ParamEditor
                    defs={CONDITION_BY_ID.get(row.condition.condition)?.params ?? []}
                    values={row.condition.params}
                    onChange={(k, v) => bridge.setCondition(current.id, row.id, { ...row.condition!, params: { ...row.condition!.params, [k]: v } })}
                  />
                )}
                <div className="mt-1 space-y-0.5">
                  {row.then.map((a, i) => (
                    <ActionLine key={i} action={a} sheetId={current.id} rowId={row.id} index={i} branch="then"
                      onEdit={() => setEditing({ kind: 'action', rowId: row.id, index: i })}
                      editingRow={editing?.kind === 'action' && editing.rowId === row.id && editing.index === i}
                      onCloseEdit={() => setEditing(null)} bridge={bridge} />
                  ))}
                  {row.then.length === 0 && <div className="text-[10px] text-stone-600">Добавь действие — оно выполнится, если условие истинно</div>}
                  <button onClick={() => setWizard({ kind: 'action', rowId: row.id, branch: 'then' })}
                    className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-stone-500 hover:bg-white/[0.04] hover:text-sky-300">
                    <Plus size={10} /> Добавить действие
                  </button>
                </div>
              </div>
            )}

            {!row.condition && (
              <div className="space-y-0.5">
                {row.then.map((a, i) => (
                  <ActionLine key={i} action={a} sheetId={current.id} rowId={row.id} index={i} branch="then"
                    onEdit={() => setEditing({ kind: 'action', rowId: row.id, index: i })}
                    editingRow={editing?.kind === 'action' && editing.rowId === row.id && editing.index === i}
                    onCloseEdit={() => setEditing(null)} bridge={bridge} />
                ))}
                <button onClick={() => setWizard({ kind: 'action', rowId: row.id, branch: 'then' })}
                  className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10px] text-stone-500 hover:bg-white/[0.04] hover:text-sky-300">
                  <Plus size={10} /> Добавить действие
                </button>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button onClick={() => setWizard({ kind: 'event', rowId: row.id })}
                className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-amber-300">
                <Plus size={10} /> Добавить вложенное событие
              </button>
              <button onClick={() => setWizard({ kind: 'action', rowId: row.id, branch: 'else' })}
                className="flex items-center gap-1 text-[10px] text-stone-500 hover:text-sky-300">
                <Plus size={10} /> Иначе…
              </button>
            </div>

            
            {(row.children ?? []).map((child) => {
              const l = lines.find((x) => x.row.id === child.id);
              return l ? renderRow(child, l.line, depth + 1) : null;
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={cn('flex h-full min-h-0 flex-col', wide && 'bg-[#0e0c09]')}>
<div className="flex shrink-0 items-center gap-1 border-b border-white/[0.07] px-2 py-1.5">
          <ListTree size={13} className="shrink-0 text-amber-400" />
          {wide && <span className="mr-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">Лист событий</span>}
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {sheets.map((s) => (
            <button
              key={s.id}
              onClick={() => setSheetId(s.id)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
                s.id === current.id ? 'bg-amber-500/15 text-amber-300' : 'text-stone-500 hover:bg-white/[0.05] hover:text-stone-300',
              )}
            >
              {s.id === current.id && <X size={9} onClick={(e) => { e.stopPropagation(); if (bridge.deleteSheet(s.id)) setSheetId(null); }} />}
              {s.name}
            </button>
          ))}
        </div>
        <button
          title="Новый лист событий"
          onClick={() => { const s = bridge.createSheet('Новый лист'); setSheetId(s.id); }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-amber-300"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.07] px-2 py-1.5">
        <input
          value={current.name}
          onChange={(e) => bridge.renameSheet(current.id, e.target.value)}
          className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] font-bold text-stone-200 focus:border-amber-500/50 focus:outline-none"
        />
        <button
          onClick={() => setWizard({ kind: 'event' })}
          className="flex shrink-0 items-center gap-1 rounded border border-white/10 bg-stone-900 px-2 py-1 text-[10px] font-bold text-stone-300 hover:border-amber-500/40 hover:text-amber-300"
        >
          <Plus size={11} /> событие
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-1 flex items-center gap-1.5 text-[9px] text-stone-600">
          <FileCode2 size={10} />
          {lines.length} событий · {maxLine} строк · {current.comment ?? 'без описания'}
        </div>
        {lines.length === 0 && (
          <div className="py-6 text-center text-[11px] text-stone-500">
            Пусто. Добавь событие через «+ событие» сверху.
          </div>
        )}
        {lines.map(({ row, line }) => renderRow(row, line, 0))}
        <button
          onClick={() => setWizard({ kind: 'event' })}
          className="mt-1 flex w-full items-center gap-1 rounded border border-dashed border-white/15 px-2 py-1.5 text-left text-[10px] text-stone-500 hover:border-amber-500/40 hover:text-amber-300"
        >
          <Plus size={11} /> Добавить событие в конец
        </button>
      </div>

      {wizard?.kind === 'condition' && !wizard.source && (
        <SourcePicker
          onPick={(source) => setWizard({ ...wizard, source })}
          onClose={() => setWizard(null)}
        />
      )}

      {wizard?.kind === 'event' && (
        <LogicWizard
          title="Добавить событие"
          subtitle="Выбери событие, на которое будет реагировать этот лист:"
          defs={EVENT_DEFS}
          onPick={(def) => {
            bridge.addRow(current.id, def.id, wizard.rowId);
            setWizard(null);
          }}
          onClose={() => setWizard(null)}
        />
      )}

      {wizard?.kind === 'condition' && wizard.source && (
        <LogicWizard
          title={`Добавить условие «${wizard.source}»`}
          subtitle="Условие определяет, выполнять ли действия. Выбери из списка:"
          defs={CONDITION_DEFS.filter((d) => d.category === wizard.source)}
          onPick={(def) => {
            if (wizard.rowId) bridge.setCondition(current.id, wizard.rowId, newCondition(def.id));
            setWizard(null);
          }}
          onClose={() => setWizard(null)}
        />
      )}

      {wizard?.kind === 'action' && (
        <LogicWizard
          title="Добавить действие"
          subtitle={wizard.branch === 'else' ? 'Действия выполняются, если условие не выполнено.' : 'Выбери, что нужно сделать.'}
          defs={ACTION_DEFS}
          onPick={(def) => {
            if (wizard.rowId) bridge.addAction(current.id, wizard.rowId, { action: def.id, params: {} }, wizard.branch ?? 'then');
            setWizard(null);
          }}
          onClose={() => setWizard(null)}
        />
      )}
    </div>
  );
}

function ActionLine({ action, sheetId, rowId, index, branch, bridge, onEdit, editingRow, onCloseEdit }: {
  action: ActionSpec; sheetId: string; rowId: string; index: number; branch: 'then' | 'else';
  bridge: SheetBridge; onEdit: () => void; editingRow: boolean; onCloseEdit: () => void;
}) {
  const def = ACTION_BY_ID.get(action.action);
  const [label, ...params] = describeParams(action.params).split(', ');
  return (
    <div className="rounded border border-white/[0.07] bg-white/[0.02] px-1.5 py-1">
      <div className="flex items-center gap-1.5">
        <Badge def={def} text={def?.label ?? action.action} />
        <span className="truncate font-mono text-[10px] text-stone-400">
          {label}{params.length ? `, ${params.join(', ')}` : ''}
        </span>
        <div className="ml-auto flex shrink-0 gap-0.5">
          <button title="Параметры" onClick={onEdit} className="text-stone-600 hover:text-amber-300"><Pencil size={10} /></button>
          <button title="Удалить действие" onClick={() => bridge.deleteAction(sheetId, rowId, index, branch)} className="text-stone-600 hover:text-red-400"><Trash2 size={10} /></button>
        </div>
      </div>
      {editingRow && (
        <div className="mt-1">
          <select
            value={action.action}
            onChange={(e) => bridge.updateAction(sheetId, rowId, index, { action: e.target.value, params: {} }, branch)}
            className="mb-1 rounded border border-white/10 bg-stone-900 px-1.5 py-0.5 text-[10px] text-stone-200"
          >
            {ACTION_DEFS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <ParamEditor
            defs={def?.params ?? []}
            values={action.params}
            onChange={(k, v) => bridge.updateAction(sheetId, rowId, index, { params: { ...action.params, [k]: v } }, branch)}
          />
          <button onClick={onCloseEdit} className="mt-1 text-[10px] text-stone-500 hover:text-amber-300">Готово</button>
        </div>
      )}
    </div>
  );
}