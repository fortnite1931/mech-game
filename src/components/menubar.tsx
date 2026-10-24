import React, { useEffect, useRef, useState } from 'react';
import { cn } from '../utils/cn.ts';

export interface MenuItemDef {
  label?: string;
  onClick?: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

export interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

export function MenuBar({ menus, brand, children }: { menus: MenuDef[]; brand?: React.ReactNode; children?: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-amber-500/15 bg-[#14110d] px-2" ref={ref}>
      {brand}
      {menus.map((m) => (
        <div key={m.label} className="relative">
          <button
            onClick={() => setOpen(open === m.label ? null : m.label)}
            onMouseEnter={() => open && setOpen(m.label)}
            className={cn(
              'rounded px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors',
              open === m.label ? 'bg-amber-500/15 text-amber-300' : 'text-stone-400 hover:bg-white/[0.05] hover:text-stone-200',
            )}
          >
            {m.label}
          </button>
          {open === m.label && (
            <div className="absolute left-0 top-full z-[70] mt-1 min-w-[248px] overflow-hidden rounded-md border border-white/15 bg-[#1a1610] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.7)]">
              {m.items.map((it, i) => it.separator ? (
                <div key={i} className="my-1 h-px bg-white/[0.08]" />
              ) : (
                <button
                  key={i}
                  disabled={it.disabled}
                  onClick={() => { setOpen(null); it.onClick?.(); }}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35',
                    it.danger ? 'text-red-300 hover:bg-red-500/15' : 'text-stone-300 hover:bg-amber-500/15 hover:text-amber-100',
                  )}
                >
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.shortcut && <span className="font-mono text-[10px] text-stone-500">{it.shortcut}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {children}
    </div>
  );
}