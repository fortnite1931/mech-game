import { useState } from 'react';
import { Search, ArrowLeft, ChevronRight, X } from 'lucide-react';
import { cn } from '../utils/cn.ts';
import { groupByCategory, type EntryDef } from '../game/sheets.ts';

const COLOR_CHIP: Record<EntryDef['color'], string> = {
  event: 'bg-amber-500/25 text-amber-300 border-amber-500/40',
  object: 'bg-emerald-500/25 text-emerald-300 border-emerald-500/40',
  action: 'bg-sky-500/25 text-sky-300 border-sky-500/40',
  system: 'bg-stone-500/30 text-stone-200 border-stone-400/40',
};

function Tile({ def, selected, onClick }: { def: EntryDef; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors',
        selected ? 'border-amber-500/70 bg-amber-500/10' : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.07]',
      )}
    >
      <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded border', COLOR_CHIP[def.color])}>
        {def.color === 'system' ? '⚙' : def.color === 'action' ? '⚡' : def.color === 'object' ? '▣' : '●'}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-stone-200">{def.label}</span>
      <ChevronRight size={11} className="shrink-0 text-stone-600" />
    </button>
  );
}

/** Мастер выбора: категории + поиск, как в Construct 3. */
export function LogicWizard({ title, subtitle, defs, onPick, onClose }: {
  title: string;
  subtitle?: string;
  defs: EntryDef[];
  onPick: (def: EntryDef) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<EntryDef | null>(null);

  const filtered = defs.filter((d) =>
    !query || d.label.toLowerCase().includes(query.toLowerCase()) || d.id.toLowerCase().includes(query.toLowerCase()));
  const groups = groupByCategory(filtered);

  const chosen = picked ?? (groups.length === 1 && groups[0].defs.length === 1 ? groups[0].defs[0] : null);
  const pickedDef = chosen && (picked || query) ? defs.find((d) => d.id === chosen.id) ?? chosen : null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[82vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg border border-white/15 bg-[#1a1610] shadow-[0_24px_70px_rgba(0,0,0,0.8)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-white/10 bg-[#262119] px-3 py-2">
          {picked && (
            <button onClick={() => { setPicked(null); setQuery(''); }} className="text-stone-400 hover:text-amber-300" title="Назад">
              <ArrowLeft size={15} />
            </button>
          )}
          <span className="flex-1 text-center text-[12px] font-bold uppercase tracking-wider text-stone-200">
            {title}
          </span>
          <button onClick={onClose} className="text-stone-500 hover:text-red-400"><X size={15} /></button>
        </div>

        {subtitle && <div className="shrink-0 px-3 pt-2 text-[11px] text-stone-400">{subtitle}</div>}

        <div className="flex shrink-0 items-center gap-2 p-3 pb-2">
          <Search size={14} className="shrink-0 text-stone-500" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-stone-200 placeholder:text-stone-600 focus:border-amber-500/50 focus:outline-none"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {groups.length === 0 && <div className="py-8 text-center text-[11px] text-stone-500">Ничего не найдено</div>}
          {groups.map((g) => (
            <div key={g.category} className="mb-3">
              <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-500">
                <span className="h-px flex-1 bg-white/[0.07]" />
                {g.category.toUpperCase()}
                <span className="h-px flex-1 bg-white/[0.07]" />
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {g.defs.map((d) => <Tile key={d.id} def={d} selected={pickedDef?.id === d.id} onClick={() => setPicked(d)} />)}
              </div>
            </div>
          ))}
        </div>

        {pickedDef?.hint && (
          <div className="shrink-0 border-t border-white/[0.07] px-3 py-2 text-[10px] leading-snug text-stone-400">
            {pickedDef.hint}
          </div>
        )}

        <div className="flex shrink-0 items-center gap-2 border-t border-white/10 px-3 py-2">
          <span className="text-[11px] text-stone-500">{pickedDef ? pickedDef.label : 'Выбери пункт'}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={onClose} className="rounded border border-white/10 px-3 py-1.5 text-[11px] text-stone-300 hover:bg-white/10">Отмена</button>
            <button
              disabled={!pickedDef}
              onClick={() => pickedDef && onPick(pickedDef)}
              className="rounded bg-amber-500 px-4 py-1.5 text-[11px] font-bold text-black disabled:opacity-40"
            >
              Далее
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Первый шаг мастера условия: выбор источника (Система / Объект / Мех). */
export function SourcePicker({ onPick, onClose }: {
  onPick: (source: string) => void;
  onClose: () => void;
}) {
  const sources = [
    { id: 'Система', hint: 'Время, переменные, выбор объектов', color: 'system' as const },
    { id: 'Объект', hint: 'Состояния, дистанция, сравнения', color: 'object' as const },
    { id: 'Мех', hint: 'Пилот, шасси, нагрев', color: 'object' as const },
  ];
  const [query, setQuery] = useState('');
  const list = sources.filter((s) => !query || s.id.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4" onMouseDown={onClose}>
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-full max-w-[640px] flex-col overflow-hidden rounded-lg border border-white/15 bg-[#1a1610] shadow-[0_24px_70px_rgba(0,0,0,0.8)]"
      >
        <div className="flex shrink-0 items-center border-b border-white/10 bg-[#262119] px-3 py-2">
          <span className="flex-1 text-center text-[12px] font-bold uppercase tracking-wider text-stone-200">Добавить условие</span>
          <button onClick={onClose} className="text-stone-500 hover:text-red-400"><X size={15} /></button>
        </div>
        <div className="shrink-0 px-3 pt-3 text-[11px] text-stone-400">Выбери объект для создания нового условия:</div>
        <div className="flex shrink-0 items-center gap-2 p-3 pb-2">
          <Search size={14} className="shrink-0 text-stone-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-stone-200 placeholder:text-stone-600 focus:outline-none"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <div className="grid grid-cols-2 gap-2">
            {list.map((s) => (
              <button
                key={s.id}
                onClick={() => onPick(s.id)}
                className="flex flex-col items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 py-4 transition-colors hover:border-amber-500/50 hover:bg-white/[0.07]"
              >
                <span className={cn('flex h-9 w-9 items-center justify-center rounded border text-lg', COLOR_CHIP[s.color])}>
                  {s.id === 'Система' ? '⚙' : '▣'}
                </span>
                <span className="text-[11px] font-bold text-stone-200">{s.id}</span>
                <span className="text-center text-[9px] leading-tight text-stone-500">{s.hint}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 justify-end gap-2 border-t border-white/10 px-3 py-2">
          <button onClick={onClose} className="rounded border border-white/10 px-3 py-1.5 text-[11px] text-stone-300 hover:bg-white/10">Отмена</button>
        </div>
      </div>
    </div>
  );
}