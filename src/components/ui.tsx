import React from 'react';
import { cn } from '../utils/cn.ts';

// ---------- Buttons ----------
export function IconBtn({ title, active, danger, onClick, children, disabled }: {
  title?: string; active?: boolean; danger?: boolean; onClick?: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-30',
        active
          ? 'border-amber-500/70 bg-amber-500/20 text-amber-300 shadow-[0_0_12px_rgba(255,154,60,0.25)]'
          : 'border-white/10 bg-white/[0.03] text-stone-400 hover:border-white/20 hover:bg-white/[0.07] hover:text-stone-200',
        danger && !active && 'hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300'
      )}
    >
      {children}
    </button>
  );
}

export function Btn({ children, onClick, variant = 'ghost', className, disabled, title }: {
  children: React.ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost' | 'danger' | 'success';
  className?: string; disabled?: boolean; title?: string;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold tracking-wide transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-40',
        variant === 'primary' && 'bg-gradient-to-b from-amber-500 to-amber-600 text-black shadow-[0_0_16px_rgba(255,154,60,0.35)] hover:from-amber-400 hover:to-amber-500',
        variant === 'ghost' && 'border border-white/10 bg-white/[0.04] text-stone-300 hover:border-white/25 hover:bg-white/[0.08] hover:text-white',
        variant === 'danger' && 'border border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20',
        variant === 'success' && 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20',
        className
      )}
    >
      {children}
    </button>
  );
}

// ---------- Section ----------
export function Section({ title, right, children, defaultOpen = true }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.06]">
      {/* div, а не button: в right могут быть свои кнопки — вложенные <button> недопустимы */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(!open); } }}
        className="flex w-full cursor-pointer items-center justify-between px-3 py-2 text-left hover:bg-white/[0.02]"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber-500/90">
          <span className={cn('inline-block text-[9px] transition-transform', !open && '-rotate-90')}>▼</span>
          {title}
        </span>
        {right}
      </div>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

// ---------- Slider ----------
export function Slider({ label, value, min, max, step = 0.01, onChange, onCommit, format }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onCommit?: () => void; format?: (v: number) => string;
}) {
  return (
    <div className="group py-1">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-medium text-stone-400">{label}</span>
        <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
          {format ? format(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onMouseUp={onCommit} onTouchEnd={onCommit}
        className="wf-slider w-full"
      />
    </div>
  );
}

// ---------- Number vector input ----------
export function Vec3({ label, value, onChange, onCommit, step = 0.1, min, max }: {
  label: string; value: [number, number, number];
  onChange: (v: [number, number, number]) => void; onCommit?: () => void;
  step?: number; min?: number; max?: number;
}) {
  const axes = [{ k: 'X', c: 'text-red-400 border-red-500/30 bg-red-500/10' }, { k: 'Y', c: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' }, { k: 'Z', c: 'text-sky-400 border-sky-500/30 bg-sky-500/10' }];
  return (
    <div className="py-1">
      <div className="mb-1 text-[11px] font-medium text-stone-400">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {axes.map((ax, i) => (
          <div key={ax.k} className={cn('flex items-center gap-1 rounded border px-1.5 py-1', ax.c)}>
            <span className="text-[10px] font-bold">{ax.k}</span>
            <input
              type="number" step={step} min={min} max={max}
              value={value[i] != null ? +(value[i] ?? 0).toFixed(3) : 0}
              onChange={(e) => {
                const v: [number, number, number] = [...value] as [number, number, number];
                v[i] = parseFloat(e.target.value) || 0;
                onChange(v);
              }}
              onBlur={onCommit}
              onKeyDown={(e) => { if (e.key === 'Enter') { onCommit?.(); (e.target as HTMLInputElement).blur(); } }}
              className="w-full bg-transparent font-mono text-[11px] text-stone-200 outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Color ----------
export function ColorRow({ label, value, onChange, onCommit }: {
  label: string; value: string; onChange: (v: string) => void; onCommit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[11px] font-medium text-stone-400">{label}</span>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase text-stone-500">{value}</span>
        <input
          type="color" value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onCommit}
          className="h-6 w-10 cursor-pointer rounded border border-white/15 bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}

// ---------- Toggle ----------
export function Toggle({ label, value, onChange, icon }: {
  label: string; value: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between rounded-md px-1 py-1.5 hover:bg-white/[0.03]"
    >
      <span className="flex items-center gap-2 text-[11px] font-medium text-stone-300">
        {icon}<span>{label}</span>
      </span>
      <span className={cn(
        'relative h-[18px] w-[34px] rounded-full transition-colors',
        value ? 'bg-amber-500/80' : 'bg-white/10'
      )}>
        <span className={cn(
          'absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all',
          value ? 'left-[18px]' : 'left-[2px]'
        )} />
      </span>
    </button>
  );
}

// ---------- Toast ----------
export interface ToastMsg { id: number; text: string; kind: 'ok' | 'err' | 'info'; }
export function Toasts({ items }: { items: ToastMsg[] }) {
  return (
    <div className="pointer-events-none fixed bottom-12 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            'animate-[toastIn_0.25s_ease-out] rounded-md border px-4 py-2 text-[12px] font-semibold shadow-2xl backdrop-blur-md',
            t.kind === 'ok' && 'border-emerald-500/50 bg-emerald-950/90 text-emerald-200',
            t.kind === 'err' && 'border-red-500/50 bg-red-950/90 text-red-200',
            t.kind === 'info' && 'border-amber-500/50 bg-[#1a140d]/95 text-amber-200'
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'max-h-[88vh] overflow-hidden rounded-xl border border-amber-500/20 bg-[#14110d] shadow-[0_0_60px_rgba(0,0,0,0.8)]',
          wide ? 'w-[720px]' : 'w-[480px]'
        )}
      >
        <div className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-4 py-3">
          <h2 className="text-[13px] font-bold uppercase tracking-[0.15em] text-amber-400">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-stone-400 hover:bg-white/10 hover:text-white">✕</button>
        </div>
        <div className="max-h-[calc(88vh-57px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
