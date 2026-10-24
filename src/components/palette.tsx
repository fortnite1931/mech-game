import React from 'react';
import {
  Bot, Shield, Hammer, BrickWall, Layers, Cylinder, Boxes, Biohazard,
  Package, Box, LifeBuoy, TrainTrack, MoveDiagonal, Recycle, Car,
  TowerControl, Crosshair, Zap, RadioTower, Lightbulb, Home, Globe,
  DoorOpen, Mountain, TreeDeciduous, Search, Eye, EyeOff, Lock,
  Unlock, Trash2, Copy, Focus, Plus, Crosshair as PlaceIcon,
} from 'lucide-react';
import { ASSETS, ASSET_CATEGORIES } from '../three/assets.ts';
import type { SceneObjectState } from '../three/EditorEngine.ts';
import { cn } from '../utils/cn.ts';

const ICONS: Record<string, React.ReactNode> = {
  mech_scout: <Bot size={22} />,
  mech_juggernaut: <Shield size={22} />,
  mech_molot: <Hammer size={22} />,
  mech_robot: <Bot size={22} />,
  barrier: <BrickWall size={22} />,
  barrier_broken: <BrickWall size={22} />,
  slab: <Layers size={22} />,
  bunker_wall: <Shield size={22} />,
  sandbags: <Package size={22} />,
  barrel: <Cylinder size={22} />,
  barrel_group: <Boxes size={22} />,
  barrel_toxic: <Biohazard size={22} />,
  container: <Package size={22} />,
  crate: <Box size={22} />,
  tires: <LifeBuoy size={22} />,
  rails: <TrainTrack size={22} />,
  girder: <MoveDiagonal size={22} />,
  scrap: <Recycle size={22} />,
  car_wreck: <Car size={22} />,
  watchtower: <TowerControl size={22} />,
  turret: <Crosshair size={22} />,
  generator: <Zap size={22} />,
  antenna: <RadioTower size={22} />,
  lamp: <Lightbulb size={22} />,
  outpost: <Home size={22} />,
  dome: <Globe size={22} />,
  checkpoint: <DoorOpen size={22} />,
  rock: <Mountain size={22} />,
  dead_tree: <TreeDeciduous size={22} />,
};

const CAT_COLORS: Record<string, string> = {
  'Мехи': 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  'Укрытия': 'text-stone-300 border-stone-500/30 bg-stone-500/10',
  'Бочки и грузы': 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Металлолом': 'text-red-400 border-red-500/30 bg-red-500/10',
  'База и техника': 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10',
  'Ландшафт': 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
};

// ---------------- Asset palette ----------------
export function AssetPalette({ placingId, onSpawn, onPlace }: {
  placingId: string | null;
  onSpawn: (id: string) => void;
  onPlace: (id: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const [cat, setCat] = React.useState<string>('Все');
  const filtered = ASSETS.filter((a) =>
    (cat === 'Все' || a.category === cat) &&
    (a.name.toLowerCase().includes(q.toLowerCase()) || a.desc.toLowerCase().includes(q.toLowerCase()))
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-2.5">
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-stone-500" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: бочка, мех, рельсы…"
            className="w-full bg-transparent text-[12px] text-stone-200 placeholder:text-stone-600 focus:outline-none"
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {['Все', ...ASSET_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-all',
                cat === c
                  ? 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-white/10 bg-white/[0.02] text-stone-500 hover:border-white/20 hover:text-stone-300'
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {placingId && (
          <div className="mb-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-300">
            <span className="font-bold">Режим размещения.</span> Клик по земле — поставить · Shift+клик — несколько · Esc — отмена
          </div>
        )}
        <div className="grid grid-cols-1 gap-1.5">
          {filtered.map((a) => {
            const placing = placingId === a.id;
            return (
              <div
                key={a.id}
                className={cn(
                  'group rounded-lg border p-2 transition-all',
                  placing
                    ? 'border-emerald-500/60 bg-emerald-500/[0.07]'
                    : 'border-white/[0.07] bg-white/[0.02] hover:border-amber-500/40 hover:bg-white/[0.05]'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-md border', CAT_COLORS[a.category])}>
                    {ICONS[a.id]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold text-stone-200">{a.name}</div>
                    <div className="truncate text-[10px] text-stone-500">{a.desc}</div>
                    <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-stone-600">{a.category}</div>
                  </div>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    onClick={() => onPlace(a.id)}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded border px-2 py-1 text-[10px] font-bold transition-all',
                      placing
                        ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300'
                        : 'border-white/10 bg-white/[0.03] text-stone-400 hover:border-emerald-500/40 hover:text-emerald-300'
                    )}
                  >
                    <PlaceIcon size={11} /> {placing ? 'Размещение…' : 'Поставить'}
                  </button>
                  <button
                    onClick={() => onSpawn(a.id)}
                    title="Добавить в центр сцены"
                    className="flex items-center justify-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold text-stone-400 transition-all hover:border-amber-500/40 hover:text-amber-300"
                  >
                    <Plus size={11} /> В центр
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        {filtered.length === 0 && (
          <div className="py-8 text-center text-[12px] text-stone-600">Ничего не найдено</div>
        )}
      </div>
      <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-stone-600">
        {ASSETS.length} моделей · процедурные PBR-материалы
      </div>
    </div>
  );
}

// ---------------- Hierarchy ----------------
export function Hierarchy({ objects, selectedId, selectedIds, onSelect, onToggleVisible, onToggleLock, onDelete, onDuplicate, onFocus }: {
  objects: SceneObjectState[];
  selectedId: string | null;
  /** Всё выделение — для подсветки нескольких объектов. */
  selectedIds?: string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onFocus: (id: string) => void;
}) {
  const [q, setQ] = React.useState('');
  const filtered = objects.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const multi = new Set(selectedIds ?? (selectedId ? [selectedId] : []));
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/[0.06] p-2.5">
        <div className="flex items-center gap-2 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-stone-500" />
          <input
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Фильтр объектов…"
            className="w-full bg-transparent text-[12px] text-stone-200 placeholder:text-stone-600 focus:outline-none"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {filtered.length === 0 && (
          <div className="py-10 text-center">
            <div className="text-[13px] font-semibold text-stone-500">Сцена пуста</div>
            <div className="mt-1 text-[11px] text-stone-600">Добавьте модели из библиотеки</div>
          </div>
        )}
        {filtered.map((o, i) => {
          const sel = selectedId === o.id;
          const inGroup = multi.has(o.id);
          return (
            <div
              key={o.id}
              onClick={(e) => onSelect(o.id, e.ctrlKey || e.metaKey)}
              className={cn(
                'group mb-0.5 flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 transition-all',
                sel
                  ? 'border-amber-500/60 bg-amber-500/[0.1]'
                  : inGroup
                    ? 'border-amber-500/30 bg-amber-500/[0.05]'
                    : 'border-transparent hover:border-white/10 hover:bg-white/[0.04]',
                !o.visible && 'opacity-45'
              )}
            >
              <span className="w-6 shrink-0 font-mono text-[9px] text-stone-600">{String(i).padStart(2, '0')}</span>
              <span className={cn('shrink-0', sel ? 'text-amber-400' : 'text-stone-500')}>
                {React.cloneElement(ICONS[o.assetId] as React.ReactElement<{ size?: number }>, { size: 15 })}
              </span>
              <span className={cn('flex-1 truncate text-[11px]', sel ? 'font-bold text-amber-200' : 'text-stone-300')}>
                {o.name}
              </span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button title="Фокус (F)" onClick={(e) => { e.stopPropagation(); onFocus(o.id); }} className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-amber-300"><Focus size={12} /></button>
                <button title="Дублировать (Ctrl+D)" onClick={(e) => { e.stopPropagation(); onDuplicate(o.id); }} className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-emerald-300"><Copy size={12} /></button>
                <button title="Удалить (Del)" onClick={(e) => { e.stopPropagation(); onDelete(o.id); }} className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-red-400"><Trash2 size={12} /></button>
              </span>
              <button
                title={o.locked ? 'Разблокировать' : 'Заблокировать'}
                onClick={(e) => { e.stopPropagation(); onToggleLock(o.id); }}
                className={cn('shrink-0 rounded p-1', o.locked ? 'text-amber-400' : 'text-stone-600 hover:text-stone-300')}
              >
                {o.locked ? <Lock size={12} /> : <Unlock size={12} />}
              </button>
              <button
                title={o.visible ? 'Скрыть' : 'Показать'}
                onClick={(e) => { e.stopPropagation(); onToggleVisible(o.id); }}
                className="shrink-0 rounded p-1 text-stone-500 hover:text-stone-200"
              >
                {o.visible ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
            </div>
          );
        })}
      </div>
      <div className="border-t border-white/[0.06] px-3 py-1.5 text-[10px] text-stone-600">
        Объектов: {objects.length}
      </div>
    </div>
  );
}
