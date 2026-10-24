import React, { useState } from 'react';
import { Folder, FolderOpen, FileCode2, Box, Layers, Cpu, ChevronRight, ChevronDown, Search } from 'lucide-react';
import { cn } from '../utils/cn.ts';
import type { EventSheet, GlobalVar } from '../game/project.ts';
import type { ObjectType } from '../game/types.ts';

export interface ProjectBridge {
  getTypes(): ObjectType[];
  getSheets(): EventSheet[];
  getGlobals(): GlobalVar[];
  getObjectCount(): number;
  focusSheet?(id: string): void;
  focusTypes?(): void;
}

interface ItemProps {
  depth: number; icon: React.ReactNode; label: string; count?: number;
  active?: boolean; onClick?: () => void; toggleKey?: string; open?: boolean; onToggle?: () => void;
}

function Item({ depth, icon, label, count, active, onClick, toggleKey, open, onToggle }: ItemProps) {
  return (
    <div
      className={cn(
        'flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] transition-colors',
        active ? 'bg-amber-500/15 text-amber-200' : 'text-stone-300 hover:bg-white/[0.06]',
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
    >
      {toggleKey ? (
        <button onClick={(e) => { e.stopPropagation(); onToggle?.(); }} className="text-stone-600 hover:text-stone-300">
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
      ) : <span className="w-[11px] shrink-0" />}
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {count !== undefined && <span className="shrink-0 font-mono text-[9px] text-stone-600">{count}</span>}
    </div>
  );
}

export function ProjectPanel({ bridge, onOpenSheet, onOpenTypes, selectedTypeId, selectedSheetId }: {
  bridge: ProjectBridge | null;
  onOpenSheet: (id: string) => void;
  onOpenTypes: () => void;
  selectedTypeId: string | null;
  selectedSheetId: string | null;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ layouts: true, sheets: true, types: true, globals: true });
  const [query, setQuery] = useState('');
  if (!bridge) return <div className="p-3 text-[11px] text-stone-500">Движок запускается…</div>;

  const types = bridge.getTypes();
  const sheets = bridge.getSheets();
  const globals = bridge.getGlobals();
  const match = (s: string) => !query || s.toLowerCase().includes(query.toLowerCase());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-white/[0.07] p-2">
        <div className="mb-1 flex items-center gap-1.5">
          <Layers size={13} className="text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Проект</span>
        </div>
        <div className="flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2 py-1">
          <Search size={11} className="text-stone-600" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск…"
            className="w-full bg-transparent text-[11px] text-stone-200 placeholder:text-stone-600 focus:outline-none" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <Item depth={0} icon={open.layouts ? <FolderOpen size={13} className="text-amber-400" /> : <Folder size={13} className="text-amber-400" />}
          label="Wasteland Forge" toggleKey="root" open={open.layouts} onToggle={() => setOpen((s) => ({ ...s, layouts: !s.layouts }))} />

        {open.layouts && (
          <>
            <Item depth={1} icon={<Layers size={12} className="text-sky-400" />} label="Макеты" count={bridge.getObjectCount()} />
            <Item depth={1} icon={<Layers size={12} className="text-sky-400" />} label="Списки событий" count={sheets.length} />

            <Item depth={1} toggleKey="sheets"
              icon={open.sheets ? <FolderOpen size={13} className="text-emerald-400" /> : <Folder size={13} className="text-emerald-400" />}
              label="Списки событий" open={open.sheets} onToggle={() => setOpen((s) => ({ ...s, sheets: !s.sheets }))} />
            {open.sheets && sheets.filter((s) => match(s.name)).map((s) => (
              <Item key={s.id} depth={2} icon={<FileCode2 size={11} className="text-emerald-300" />}
                label={s.name} count={s.rows?.length ?? 0} active={selectedSheetId === s.id} onClick={() => onOpenSheet(s.id)} />
            ))}

            <Item depth={1} toggleKey="types"
              icon={open.types ? <FolderOpen size={13} className="text-sky-400" /> : <Folder size={13} className="text-sky-400" />}
              label="Типы объектов" open={open.types} onToggle={() => setOpen((s) => ({ ...s, types: !s.types }))} />
            {open.types && types.filter((t) => match(t.name)).map((t) => (
              <Item key={t.id} depth={2} icon={<Box size={11} className="text-sky-300" />}
                label={t.name} active={selectedTypeId === t.id} onClick={onOpenTypes}
                count={undefined} />
            ))}

            <Item depth={1} toggleKey="globals"
              icon={open.globals ? <FolderOpen size={13} className="text-amber-400" /> : <Folder size={13} className="text-amber-400" />}
              label="Глобальные переменные" open={open.globals} onToggle={() => setOpen((s) => ({ ...s, globals: !s.globals }))} />
            {open.globals && globals.filter((g) => match(g.name)).map((g) => (
              <Item key={g.id} depth={2} icon={<Cpu size={11} className="text-amber-300" />} label={`${g.name}: ${g.def}`} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}