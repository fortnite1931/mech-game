import { Plus, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react';
import React from 'react';
import type { Scenario, WaveDef, EnemyKindId } from '../three/playTypes.ts';
import { ENEMY_KINDS, ENEMY_KIND_INFO, CHASSIS } from '../three/playTypes.ts';
import { ITEMS, type ItemId, type LootTable, type Recipe } from '../game/playerKit.ts';
import { ASSETS } from '../three/assets.ts';
import { Section, Slider, Btn, Toggle } from './ui.tsx';
import { cn } from '../utils/cn.ts';

function Num({ value, onCommit, min, max, step = 1 }: {
  value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number" defaultValue={value} min={min} max={max} step={step} key={value}
      onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onCommit(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
    />
  );
}

const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

/** Редактор таблиц добычи: шанс, количество и источники для каждого предмета. */
function LootEditor({ scenario, onChange }: { scenario: Scenario; onChange: (s: Scenario) => void }) {
  const [open, setOpen] = React.useState<string | null>(null);

  const patchTable = (id: string, patch: Partial<LootTable>) =>
    onChange({ ...scenario, loot: scenario.loot.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  const patchEntry = (tableId: string, index: number, patch: Partial<LootTable['entries'][number]>) =>
    onChange({
      ...scenario,
      loot: scenario.loot.map((t) => (t.id !== tableId ? t : {
        ...t,
        entries: t.entries.map((e, i) => (i === index ? { ...e, ...patch } : e)),
      })),
    });

  const addEntry = (tableId: string) =>
    onChange({
      ...scenario,
      loot: scenario.loot.map((t) => (t.id !== tableId ? t : {
        ...t, entries: [...t.entries, { item: 'scrap', min: 1, max: 1, chance: 0.5 }],
      })),
    });

  const removeEntry = (tableId: string, index: number) =>
    onChange({
      ...scenario,
      loot: scenario.loot.map((t) => (t.id !== tableId ? t : { ...t, entries: t.entries.filter((_, i) => i !== index) })),
    });

  const toggleSource = (tableId: string, assetId: string) =>
    onChange({
      ...scenario,
      loot: scenario.loot.map((t) => (t.id !== tableId ? t : {
        ...t,
        from: t.from.includes(assetId) ? t.from.filter((x) => x !== assetId) : [...t.from, assetId],
      })),
    });

  return (
    <div className="space-y-1">
      {scenario.loot.map((t) => {
        const isOpen = open === t.id;
        const avg = t.entries.length
          ? Math.round(t.entries.reduce((n, e) => n + e.chance, 0) / t.entries.length * 100)
          : 0;
        return (
          <div key={t.id} className="rounded-md border border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-1.5 p-1.5">
              <button onClick={() => setOpen(isOpen ? null : t.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/10 text-stone-500 hover:text-amber-300">
                {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-bold text-stone-100">
                  {t.name}
                  {t.salvage && <span className="ml-1 rounded bg-red-500/20 px-1 text-[9px] font-bold text-red-300">РАЗБОР</span>}
                </div>
                <div className="truncate text-[9px] text-stone-500">
                  {t.enabled === false ? 'выключен · ' : ''}
                  {t.from.length} источник(ов) · {t.entries.length} поз. · ср. шанс {avg}%
                </div>
              </div>
              <Toggle label="" value={t.enabled !== false} onChange={(v) => patchTable(t.id, { enabled: v })} />
            </div>

            {isOpen && (
              <div className="space-y-2 border-t border-white/[0.07] p-2">
                <div>
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">
                    Источники (что даёт этот стол)
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ASSETS.map((a) => {
                      const on = t.from.includes(a.id);
                      const fit = t.salvage
                        ? a.id.startsWith('mech_') || a.id === 'pilot_human' || a.id === 'survivor'
                        : !a.id.startsWith('mech_');
                      if (!fit) return null;
                      return (
                        <button key={a.id} onClick={() => toggleSource(t.id, a.id)}
                          title={a.name}
                          className={cn(
                            'rounded border px-1.5 py-0.5 text-[9px] transition-all',
                            on ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-200' : 'border-white/10 text-stone-500 hover:border-white/25',
                          )}>
                          {a.name.split('—')[0].trim()}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-stone-500">
                    Выпадающие предметы
                  </div>
                  <div className="space-y-1">
                    {t.entries.map((e, i) => (
                      <div key={i} className="flex items-center gap-1 rounded bg-black/30 px-1 py-1">
                        <select
                          value={e.item}
                          onChange={(ev) => patchEntry(t.id, i, { item: ev.target.value as ItemId })}
                          className="min-w-0 flex-1 rounded border border-white/10 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                        >
                          {ITEM_IDS.map((id) => <option key={id} value={id}>{ITEMS[id].short}</option>)}
                        </select>
                        <label className="flex items-center gap-0.5 font-mono text-[9px] text-stone-500">
                          <input
                            type="number" min={0} max={99} value={e.min}
                            onChange={(ev) => {
                              const min = Math.max(0, parseInt(ev.target.value || '0', 10));
                              patchEntry(t.id, i, { min, max: Math.max(min, e.max) });
                            }}
                            className="w-9 rounded border border-white/10 bg-black/50 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                          />
                          —
                          <input
                            type="number" min={0} max={99} value={e.max}
                            onChange={(ev) => patchEntry(t.id, i, { max: Math.max(e.min, parseInt(ev.target.value || '0', 10)) })}
                            className="w-9 rounded border border-white/10 bg-black/50 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                          />
                        </label>
                        <label className="flex items-center gap-1 font-mono text-[9px] text-stone-500" title="Шанс выпадения">
                          <input
                            type="range" min={0} max={100} value={Math.round(e.chance * 100)}
                            onChange={(ev) => patchEntry(t.id, i, { chance: parseInt(ev.target.value, 10) / 100 })}
                            className="w-14 accent-amber-500"
                          />
                          <span className="w-7 text-right text-stone-300">{Math.round(e.chance * 100)}%</span>
                        </label>
                        <button onClick={() => removeEntry(t.id, i)} title="Убрать позицию"
                          className="shrink-0 rounded p-0.5 text-stone-600 hover:text-red-400">
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Btn className="mt-1 w-full" onClick={() => addEntry(t.id)}>
                    <Plus size={12} /> Добавить предмет
                  </Btn>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Редактор рецептов сборки меха. */
function CraftEditor({ scenario, onChange }: { scenario: Scenario; onChange: (s: Scenario) => void }) {
  const addRecipe = () => {
    const r: Recipe = {
      id: `recipe_${Date.now().toString(36)}`,
      name: 'Новый рецепт',
      chassis: 'mech_scout',
      limit: 0,
      desc: 'Своя сборка.',
      parts: [{ item: 'scrap', count: 10 }],
    };
    onChange({ ...scenario, craft: [...scenario.craft, r] });
  };

  const patch = (id: string, p: Partial<Recipe>) =>
    onChange({ ...scenario, craft: scenario.craft.map((r) => (r.id === id ? { ...r, ...p } : r)) });

  const remove = (id: string) =>
    onChange({ ...scenario, craft: scenario.craft.filter((r) => r.id !== id) });

  const total = (r: Recipe) => r.parts.reduce((n, p) => n + p.count * ITEMS[p.item].weight, 0);

  return (
    <div className="space-y-1.5">
      {scenario.craft.map((r) => (
        <div key={r.id} className="rounded-md border border-white/10 bg-white/[0.02] p-2">
          <div className="mb-1 flex items-center gap-1">
            <input
              value={r.name}
              onChange={(e) => patch(r.id, { name: e.target.value.slice(0, 40) })}
              className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[11px] font-bold text-stone-100 focus:border-amber-500/50 focus:outline-none"
            />
            <button onClick={() => remove(r.id)} title="Удалить рецепт"
              className="shrink-0 rounded p-1 text-stone-600 hover:text-red-400">
              <Trash2 size={12} />
            </button>
          </div>

          <div className="mb-1 flex items-center gap-1">
            <select
              value={r.chassis}
              onChange={(e) => patch(r.id, { chassis: e.target.value })}
              className="flex-1 rounded border border-white/10 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
            >
              {Object.entries(CHASSIS).map(([id, c]) => <option key={id} value={id}>{c.name}</option>)}
            </select>
            <span className="shrink-0 font-mono text-[9px] text-stone-500">{total(r)} кг</span>
          </div>

          <div className="space-y-1">
            {r.parts.map((p, i) => (
              <div key={i} className="flex items-center gap-1 rounded bg-black/30 px-1 py-0.5">
                <select
                  value={p.item}
                  onChange={(e) => patch(r.id, {
                    parts: r.parts.map((x, j) => (j === i ? { ...x, item: e.target.value as ItemId } : x)),
                  })}
                  className="min-w-0 flex-1 rounded border border-white/10 bg-stone-900 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                >
                  {ITEM_IDS.map((id) => <option key={id} value={id}>{ITEMS[id].short}</option>)}
                </select>
                <input
                  type="number" min={1} max={99} value={p.count}
                  onChange={(e) => patch(r.id, {
                    parts: r.parts.map((x, j) => (j === i ? { ...x, count: Math.max(1, parseInt(e.target.value || '1', 10)) } : x)),
                  })}
                  className="w-12 rounded border border-white/10 bg-black/50 px-1 py-0.5 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                />
                <button onClick={() => patch(r.id, { parts: r.parts.filter((_, j) => j !== i) })}
                  className="shrink-0 rounded p-0.5 text-stone-600 hover:text-red-400">
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-1 flex gap-1">
            <Btn className="flex-1"
              onClick={() => patch(r.id, { parts: [...r.parts, { item: 'plate', count: 2 }] })}>
              <Plus size={11} /> Деталь
            </Btn>
            <Btn className="flex-1" title="Описание для панели сборки"
              onClick={() => patch(r.id, { desc: window.prompt('Описание рецепта', r.desc) ?? r.desc })}>
              Описание
            </Btn>
          </div>
        </div>
      ))}
      <Btn className="w-full" onClick={addRecipe}>
        <Plus size={12} /> Новый рецепт
      </Btn>
      <div className="text-[9px] leading-snug text-stone-600">
        Рецепты хранятся в проекте и применяются в превью по <b className="text-stone-400">B</b>.
        Источник редких деталей — разбор вражеских машин: «Ястреб» даёт кабину, «Молот» — гидроцилиндры, «Титан» — редкий металл и реактор.
      </div>
    </div>
  );
}

export function ScenarioPanel({ scenario, onChange }: {
  scenario: Scenario; onChange: (s: Scenario) => void;
}) {
  const set = (patch: Partial<Scenario>) => onChange({ ...scenario, ...patch });
  const setWave = (i: number, patch: Partial<WaveDef>) =>
    set({ waves: scenario.waves.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
  const addWave = () => set({
    waves: [...scenario.waves, {
      name: 'Волна ' + (scenario.waves.length + 1),
      count: 3, kinds: ['mech_scout' as EnemyKindId], delaySec: 8, radius: 75,
    }],
  });
  const delWave = (i: number) => set({ waves: scenario.waves.filter((_, j) => j !== i) });
  const toggleKind = (i: number, k: EnemyKindId) => {
    const cur = scenario.waves[i].kinds;
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k];
    setWave(i, { kinds: next.length ? next : ['mech_scout' as EnemyKindId] });
  };

  return (
    <div className="overflow-y-auto">
      <Section title="Игрок">
        <div className="mb-1 text-[11px] font-medium text-stone-400">Прочность меха</div>
        <Num value={scenario.playerHp} min={50} max={2000} step={10}
          onCommit={(v) => set({ playerHp: Math.max(50, Math.min(2000, Math.round(v))) })} />
      </Section>

      <Section title="Баланс врагов">
        <Slider label="Прочность врагов ×" value={scenario.enemyHpMul} min={0.2} max={3}
          onChange={(v) => set({ enemyHpMul: v })} format={(v) => `${v.toFixed(2)}×`} />
        <Slider label="Урон врагов ×" value={scenario.enemyDmgMul} min={0} max={3}
          onChange={(v) => set({ enemyDmgMul: v })} format={(v) => `${v.toFixed(2)}×`} />
      </Section>

      <Section title="Добыча и крафт">
        <div className="mb-2 space-y-1">
          <Toggle label="Лут с мусора на карте" value={scenario.lootSettings.enabled}
            onChange={(v) => set({ lootSettings: { ...scenario.lootSettings, enabled: v } })} />
          <Toggle label="Автоподбор рядом с игроком" value={scenario.lootSettings.autoPickup}
            onChange={(v) => set({ lootSettings: { ...scenario.lootSettings, autoPickup: v } })} />
          <Toggle label="Разбирать уничтоженные машины" value={scenario.lootSettings.salvage}
            onChange={(v) => set({ lootSettings: { ...scenario.lootSettings, salvage: v } })} />
          <Slider label="Щедрость мусорного лута, %" value={scenario.lootSettings.rarityBoost * 100} min={0} max={200} step={5}
            onChange={(v) => set({ lootSettings: { ...scenario.lootSettings, rarityBoost: v / 100 } })}
            format={(v) => `${Math.round(v)}%`} />
          <Slider label="Множитель разбора машин" value={scenario.lootSettings.salvageMul} min={0.5} max={3} step={0.1}
            onChange={(v) => set({ lootSettings: { ...scenario.lootSettings, salvageMul: v } })}
            format={(v) => `${v.toFixed(1)}×`} />
        </div>

        {/* --- Таблицы добычи --- */}
        <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-stone-400">
          Таблицы добычи
        </div>
        <LootEditor scenario={scenario} onChange={onChange} />

        {/* --- Рецепты крафта --- */}
        <div className="mb-1 mt-3 text-[11px] font-bold uppercase tracking-wider text-stone-400">
          Рецепты сборки меха
        </div>
        <CraftEditor scenario={scenario} onChange={onChange} />
      </Section>

      <Section title="Враги-NPC и патруль">
        <Toggle label="NPC ходят по маршруту" value={scenario.npc.enabled}
          onChange={(v) => set({ npc: { ...scenario.npc, enabled: v } })} />
        <Slider label="Радиус маршрута, м" value={scenario.npc.patrolRadius} min={2} max={60} step={1}
          onChange={(v) => set({ npc: { ...scenario.npc, patrolRadius: v } })} format={(v) => `${Math.round(v)} м`} />
        <Slider label="Скорость патруля (доля от боевой)" value={scenario.npc.patrolSpeed} min={0.1} max={1} step={0.05}
          onChange={(v) => set({ npc: { ...scenario.npc, patrolSpeed: v } })} format={(v) => v.toFixed(2)} />
        <Slider label="Точек в маршруте" value={scenario.npc.waypoints} min={1} max={10} step={1}
          onChange={(v) => set({ npc: { ...scenario.npc, waypoints: Math.round(v) } })} format={(v) => `${Math.round(v)}`} />
        <Slider label="Пауза на точке, с" value={scenario.npc.pauseSec} min={0} max={12} step={0.5}
          onChange={(v) => set({ npc: { ...scenario.npc, pauseSec: v } })} format={(v) => `${v.toFixed(1)} с`} />
        <div className="my-1.5 h-px bg-white/[0.06]" />
        <Slider label="Обнаружение игрока, м" value={scenario.npc.aggro} min={5} max={150} step={1}
          onChange={(v) => set({ npc: { ...scenario.npc, aggro: v } })} format={(v) => `${Math.round(v)} м`} />
        <Slider label="Задержка реакции, с" value={scenario.npc.alertSec} min={0} max={3} step={0.1}
          onChange={(v) => set({ npc: { ...scenario.npc, alertSec: v } })} format={(v) => `${v.toFixed(1)} с`} />
        <Slider label="Отход от базы (привязка), м" value={scenario.npc.leash} min={10} max={200} step={5}
          onChange={(v) => set({ npc: { ...scenario.npc, leash: v } })} format={(v) => `${Math.round(v)} м`} />
        <Toggle label="Возвращаться на базу" value={scenario.npc.returnHome}
          onChange={(v) => set({ npc: { ...scenario.npc, returnHome: v } })} />
        <div className="mt-2 text-[10px] leading-relaxed text-stone-600">
          Маршрут строится вокруг точки появления NPC: N случайных точек, обход по кругу с паузами.
          Увидев игрока, NPC поворачиваются и целятся (задержка реакции), затем идут в атаку.
          Если игрок ушёл дальше «отхода от базы» — NPC возвращаются на точку и забывают его.
          В сцене NPC получаются из объектов с ролью «Враг».
        </div>
      </Section>

      <Section title={`Волны (${scenario.waves.length})`}>
        {scenario.waves.length === 0 && (
          <div className="mb-2 rounded-md border border-white/10 bg-white/[0.02] p-2 text-[11px] text-stone-500">
            Волн нет — превью останется песочницей: врагами будут только объекты с ролью «Враг».
          </div>
        )}
        {scenario.waves.map((w, i) => (
          <div key={i} className="mb-2 rounded-md border border-white/10 bg-white/[0.02] p-2">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span className="font-mono text-[10px] font-black text-amber-400">{i + 1}</span>
              <input
                value={w.name}
                onChange={(e) => setWave(i, { name: e.target.value.slice(0, 40) })}
                className="w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] font-bold text-stone-100 focus:border-amber-500/50 focus:outline-none"
              />
              <button onClick={() => delWave(i)} title="Удалить волну"
                className="rounded p-1.5 text-stone-500 hover:bg-red-500/10 hover:text-red-300">
                <Trash2 size={13} />
              </button>
            </div>
            <div className="mb-1.5 grid grid-cols-3 gap-1.5">
              <div>
                <div className="mb-0.5 text-[10px] text-stone-500">Штук</div>
                <Num value={w.count} min={1} max={12} onCommit={(v) => setWave(i, { count: Math.max(1, Math.min(12, Math.round(v))) })} />
              </div>
              <div>
                <div className="mb-0.5 text-[10px] text-stone-500">Пауза, с</div>
                <Num value={w.delaySec} min={0} max={120} onCommit={(v) => setWave(i, { delaySec: Math.max(0, Math.min(120, Math.round(v))) })} />
              </div>
              <div>
                <div className="mb-0.5 text-[10px] text-stone-500">Радиус, м</div>
                <Num value={w.radius} min={20} max={105} step={5} onCommit={(v) => setWave(i, { radius: Math.max(20, Math.min(105, Math.round(v))) })} />
              </div>
            </div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">Состав</div>
            {ENEMY_KINDS.map((k) => (
              <Toggle key={k} label={ENEMY_KIND_INFO[k].label} value={w.kinds.includes(k)} onChange={() => toggleKind(i, k)} />
            ))}
          </div>
        ))}
        <Btn onClick={addWave} className={cn('w-full')}>
          <Plus size={13} /> Добавить волну
        </Btn>
        <div className="mt-2 text-[10px] leading-relaxed text-stone-600">
          Волна приходит после зачистки предыдущей (первая — через паузу после старта). Победа — зачистить все волны. Размещённые враги тоже считаются.
        </div>
      </Section>
    </div>
  );
}
