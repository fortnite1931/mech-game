import React, { useState } from 'react';
import { Boxes, Copy, Plus, Trash2, ChevronRight, Wrench, Cpu, Wand2 } from 'lucide-react';
import { Section, Btn, Toggle, Slider, ColorRow } from './ui.tsx';
import { cn } from '../utils/cn.ts';
import type { PropDef, PropValue } from '../game/props.ts';
import { BEHAVIORS, BEHAVIOR_IDS, behaviorDefaults, type BehaviorId } from '../game/behaviors.ts';
import {
  CATEGORY_LABEL, ROLE_LABEL, typesUsing, wouldCycle,
  type BehaviorInstance, type ObjectType, type Role, type TypeCategory,
} from '../game/types.ts';

const ROLES: Role[] = ['player', 'enemy', 'reserve', 'neutral'];
const CATEGORIES: TypeCategory[] = ['mech', 'pilot', 'turret', 'prop', 'marker'];

interface Bridge {
  getTypes(): ObjectType[];
  createType(p: Partial<ObjectType> & { name: string }): ObjectType;
  updateType(id: string, patch: Partial<ObjectType>): boolean;
  updateBehavior(typeId: string, behaviorId: string, patch: { enabled?: boolean; settings?: Record<string, PropValue> }): boolean;
  duplicateType(id: string): ObjectType | null;
  deleteType(id: string): boolean;
  applyPlayerType(): boolean;
}

function PropField({ def, value, onChange }: {
  def: PropDef; value: PropValue | undefined; onChange: (v: PropValue) => void;
}) {
  switch (def.kind) {
    case 'bool':
      return <Toggle label={def.label} value={value !== false && value !== 'false'} onChange={(v) => onChange(v)} />;
    case 'number':
      return (
        <Slider label={def.label} value={Number(value ?? def.def)} min={def.min ?? 0} max={def.max ?? 100} step={def.step ?? 0.05}
          onChange={(v) => onChange(v)}
          format={(v) => (def.step && def.step >= 1 ? `${v.toFixed(0)}` : v.toFixed(2))} />
      );
    case 'enum':
      return (
        <div>
          <div className="mb-0.5 text-[11px] font-medium text-stone-400">{def.label}</div>
          <select
            value={String(value ?? def.def)}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          >
            {def.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      );
    case 'color':
      return <ColorRow label={def.label} value={String(value ?? def.def)} onChange={(v) => onChange(v)} />;
    default:
      return (
        <div>
          <div className="mb-0.5 text-[11px] font-medium text-stone-400">{def.label}</div>
          <input
            value={String(value ?? def.def)}
            onChange={(e) => onChange(e.target.value)}
            className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          />
        </div>
      );
  }
}

function PropGroup({ defs, values, onChange, title }: {
  defs: PropDef[]; values: Record<string, PropValue | undefined>;
  onChange: (key: string, v: PropValue) => void; title: string;
}) {
  return (
    <div className="rounded border border-white/[0.07] bg-white/[0.02] p-2">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-amber-500/80">{title}</div>
      <div className="space-y-1">{defs.map((d) => <PropField key={d.key} def={d} value={values[d.key]} onChange={(v) => onChange(d.key, v)} />)}</div>
    </div>
  );
}

function groupProps(defs: PropDef[]): { group: string; defs: PropDef[] }[] {
  const map = new Map<string, PropDef[]>();
  for (const d of defs) {
    const g = d.group ?? 'Общие';
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(d);
  }
  return Array.from(map.entries()).map(([group, list]) => ({ group, defs: list }));
}

export function TypesPanel({ bridge, selectedTypeId, onSelectType, toast, selectedObject, onAssignType }: {
  bridge: Bridge | null;
  selectedTypeId: string | null;
  onSelectType: (id: string | null) => void;
  toast: (text: string, kind?: 'ok' | 'err' | 'info') => void;
  /** Выделенный объект сцены — панель показывает его тип. */
  selectedObject?: { id: string; name: string; assetId: string; typeId?: string } | null;
  /** Назначить объекту тип. */
  onAssignType?: (objectId: string, typeId: string) => void;
}) {
  const types = bridge ? bridge.getTypes() : [];
  const [open, setOpen] = useState<string | null>(selectedTypeId ?? types[0]?.id ?? null);
  const [tab, setTab] = useState<'props' | 'behaviors'>('props');
  const [query, setQuery] = useState('');

  React.useEffect(() => { if (selectedTypeId) setOpen(selectedTypeId); }, [selectedTypeId]);

  if (!bridge) {
    return <div className="p-3 text-[11px] text-stone-500">Движок запускается…</div>;
  }

  const type = types.find((t) => t.id === open) ?? null;
  const filtered = types.filter((t) =>
    !query || t.name.toLowerCase().includes(query.toLowerCase()) || t.id.includes(query.toLowerCase()));

  const addType = () => {
    const t = bridge.createType({ name: 'Новый тип', category: 'prop', role: 'neutral' });
    setOpen(t.id);
    toast(`Тип «${t.name}» создан`, 'ok');
  };

  const dup = () => {
    if (!type) return;
    const c = bridge.duplicateType(type.id);
    if (c) { setOpen(c.id); toast('Тип продублирован', 'ok'); }
  };

  const del = () => {
    if (!type) return;
    const kids = typesUsing(types, type.id).length;
    if (kids > 1) { toast('Нельзя удалить: тип используется как родитель', 'err'); return; }
    if (!bridge.deleteType(type.id)) { toast('Тип используется объектами сцены — сначала смени их тип', 'err'); return; }
    setOpen(null);
    toast('Тип удалён', 'ok');
  };

  const setBehavior = (bid: BehaviorId, patch: { enabled?: boolean; settings?: Record<string, PropValue> }) => {
    if (!type) return;
    bridge.updateBehavior(type.id, bid, patch);
  };

  const addBehavior = (bid: BehaviorId) => {
    if (!type) return;
    const list: BehaviorInstance[] = [...type.behaviors, { id: bid, enabled: true, settings: behaviorDefaults(bid) }];
    bridge.updateType(type.id, { behaviors: list });
  };

  const removeBehavior = (bid: BehaviorId) => {
    if (!type) return;
    bridge.updateType(type.id, { behaviors: type.behaviors.filter((b) => b.id !== bid) });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {selectedObject && (
        <div className="shrink-0 border-b border-white/[0.07] bg-amber-500/[0.04] p-2">
          <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-400">Выделенный объект</div>
          <div className="truncate text-[12px] font-bold text-stone-100">{selectedObject.name}</div>
          <div className="mt-0.5 truncate text-[9px] text-stone-500">{selectedObject.assetId}</div>
          <select
            value={selectedObject.typeId ?? ''}
            onChange={(e) => { if (e.target.value) onAssignType?.(selectedObject.id, e.target.value); }}
            className="mt-1.5 w-full rounded border border-white/10 bg-stone-900 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          >
            <option value="">— тип не назначен —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className="shrink-0 border-b border-white/[0.07] p-2">
        <div className="mb-1.5 flex items-center gap-1.5">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск типа…"
            className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          />
          <Btn onClick={addType} title="Создать тип"><Plus size={13} /></Btn>
        </div>
        <div className="space-y-0.5">
          {filtered.map((t) => {
            const kids = types.filter((x) => x.parentTypeId === t.id).length;
            return (
              <button
                key={t.id}
                onClick={() => { setOpen(t.id); onSelectType(t.id); setTab('props'); }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                  open === t.id ? 'bg-amber-500/15 text-amber-200' : 'text-stone-300 hover:bg-white/[0.05]',
                )}
              >
                <ChevronRight size={10} className="shrink-0 text-stone-600" />
                <span className="flex-1 truncate font-semibold">{t.name}</span>
                {kids > 0 && <span className="shrink-0 font-mono text-[9px] text-sky-400/70">+{kids}</span>}
                <span className={cn(
                  'shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase',
                  t.role === 'player' && 'bg-emerald-500/25 text-emerald-300',
                  t.role === 'enemy' && 'bg-red-500/25 text-red-300',
                  t.role === 'reserve' && 'bg-sky-500/25 text-sky-300',
                  t.role === 'neutral' && 'bg-white/10 text-stone-400',
                )}>{ROLE_LABEL[t.role]}</span>
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-1 py-1 text-[10px] text-stone-500">Ничего не найдено</div>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!type ? (
          <div className="p-3 text-[11px] text-stone-500">Выбери тип слева или создай новый.</div>
        ) : (
          <>
            <Section title="Основа">
              <div className="space-y-1.5">
                <div>
                  <div className="mb-0.5 text-[10px] text-stone-500">Название</div>
                  <input
                    value={type.name}
                    onChange={(e) => bridge.updateType(type.id, { name: e.target.value })}
                    className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <div className="mb-0.5 text-[10px] text-stone-500">Категория</div>
                    <select
                      value={type.category}
                      onChange={(e) => bridge.updateType(type.id, { category: e.target.value as TypeCategory })}
                      className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1 text-[11px] text-stone-200 focus:outline-none"
                    >
                      {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                    </select>
                  </div>
                  <div>
                    <div className="mb-0.5 text-[10px] text-stone-500">Роль</div>
                    <select
                      value={type.role}
                      onChange={(e) => bridge.updateType(type.id, { role: e.target.value as Role })}
                      className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1 text-[11px] text-stone-200 focus:outline-none"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <div className="mb-0.5 text-[10px] text-stone-500">Родитель (наследование настроек)</div>
                  <select
                    value={type.parentTypeId ?? ''}
                    onChange={(e) => {
                      const pid = e.target.value || undefined;
                      if (pid && wouldCycle(types, type.id, pid)) { toast('Так получится зацикливание', 'err'); return; }
                      bridge.updateType(type.id, { parentTypeId: pid });
                    }}
                    className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1 text-[11px] text-stone-200 focus:outline-none"
                  >
                    <option value="">— без наследования —</option>
                    {types.filter((t) => t.id !== type.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                {type.desc && <p className="text-[10px] leading-snug text-stone-500">{type.desc}</p>}
                <div className="grid grid-cols-3 gap-1.5 pt-0.5">
                  <Btn onClick={dup} title="Дублировать тип"><Copy size={12} />Копия</Btn>
                  <Btn onClick={() => {
                    if (!bridge.applyPlayerType()) { toast('Нет типа с ролью «Игрок»', 'err'); return; }
                    toast('Настройки типа применены к меху игрока', 'ok');
                  }} title="Перенести настройки в живой мех игрока"><Wand2 size={12} />В игру</Btn>
                  <Btn variant="danger" onClick={del}><Trash2 size={12} /></Btn>
                </div>
              </div>
            </Section>

            <div className="flex border-b border-white/[0.07]">
              {([['props', 'Свойства', Boxes], ['behaviors', 'Поведения', Cpu]] as const).map(([id, label, Icon]) => (
                <button key={id} onClick={() => setTab(id)}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold uppercase tracking-wider',
                    tab === id ? 'border-b-2 border-amber-500 bg-amber-500/[0.06] text-amber-300' : 'text-stone-500 hover:text-stone-300',
                  )}>
                  <Icon size={12} />{label}
                </button>
              ))}
            </div>

            {tab === 'props' ? (
              <div className="space-y-1.5 p-2">
                {groupProps(BEHAVIORS.movement.props.filter(() => false).concat(typeProps(type))).length === 0 && (
                  <div className="text-[11px] text-stone-500">У типа нет собственных свойств.</div>
                )}
                {groupProps(typeProps(type)).map((g) => (
                  <PropGroup key={g.group} title={g.group} defs={g.defs} values={type.props}
                    onChange={(key, v) => bridge.updateType(type.id, { props: { ...type.props, [key]: v } })} />
                ))}
              </div>
            ) : (
              <div className="space-y-1.5 p-2">
                {type.behaviors.length === 0 && (
                  <div className="text-[11px] text-stone-500">Поведения не подключены. Добавь модуль ниже.</div>
                )}
                {type.behaviors.map((b) => {
                  const def = BEHAVIORS[b.id];
                  if (!def) return null;
                  return (
                    <div key={b.id} className="rounded border border-white/[0.07] bg-white/[0.02]">
                      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5">
                        <Wrench size={11} className="shrink-0 text-amber-400" />
                        <span className="flex-1 truncate text-[11px] font-bold text-stone-200">{def.name}</span>
                        <span className="shrink-0 text-[9px] uppercase text-stone-500">{def.category}</span>
                        <Toggle label="" value={b.enabled} onChange={(v) => setBehavior(b.id, { enabled: v })} />
                        <button onClick={() => removeBehavior(b.id)} className="text-stone-600 hover:text-red-400" title="Отключить модуль">
                          <Trash2 size={11} />
                        </button>
                      </div>
                      <div className="space-y-1.5 p-2">
                        <p className="text-[10px] leading-snug text-stone-500">{def.desc}</p>
                        {groupProps(def.props).map((g) => (
                          <PropGroup key={g.group} title={g.group} defs={g.defs} values={b.settings}
                            onChange={(key, v) => setBehavior(b.id, { settings: { [key]: v } })} />
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="rounded border border-dashed border-white/15 p-2">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-500">Добавить модуль</div>
                  <div className="flex flex-wrap gap-1">
                    {BEHAVIOR_IDS.filter((id) => !type.behaviors.some((b) => b.id === id)).map((id) => (
                      <Btn key={id} onClick={() => addBehavior(id)}><Plus size={11} />{BEHAVIORS[id].name}</Btn>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Собственные свойства типа: пока объявлены явно, чтобы форму можно было расширять. */
function typeProps(type: ObjectType): PropDef[] {
  const base: PropDef[] = [
    { key: 'chassis', label: 'Шасси', kind: 'enum', def: 'mech_scout', options: [
      { value: 'mech_scout', label: '«Ястреб»' },
      { value: 'mech_juggernaut', label: '«Титан»' },
      { value: 'mech_molot', label: '«Молот»' },
    ] },
    { key: 'tonnage', label: 'Тоннаж', kind: 'number', def: 35, min: 1, max: 200, step: 1 },
    { key: 'contents', label: 'Содержимое', kind: 'enum', def: 'none', options: [
      { value: 'none', label: 'пусто' },
      { value: 'fuel', label: 'топливо' },
      { value: 'tox', label: 'токсичное' },
    ] },
  ];
  return base.filter((d) => d.key in (type.props ?? {}) || type.category !== 'prop' || d.key === 'contents');
}