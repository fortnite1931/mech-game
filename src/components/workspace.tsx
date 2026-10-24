import React, { useRef, useState } from 'react';
import { cn } from '../utils/cn.ts';
import { PANELS, ALL_PANEL_IDS, type PanelId } from '../editor/panels.ts';
import {
  movePanel, setActive, closePanel, setSize, toggleCollapsed, setCollapsed, detach, dragSize,
  FLOAT_LIMITS, ZONES, type DockLayout, type DockZone, type ZoneId,
} from '../editor/dockLayout.ts';
import {
  ListTree, Library, SlidersHorizontal, CloudSun, MapPinned, Gamepad2,
  Radiation, FileAudio, Compass, Terminal, Wand2, Boxes, FolderTree, Bot, Save, Hammer, X, Plus, GripVertical, LayoutPanelTop, Film,
} from 'lucide-react';

type IconType = React.ComponentType<{ size?: number; className?: string }>;

const PANEL_ICONS: Record<PanelId, IconType> = {
  hierarchy: ListTree,
  assets: Library,
  inspector: SlidersHorizontal,
  environment: CloudSun,
  types: Boxes,
  sheets: ListTree,
  project: FolderTree,
  fx: Wand2,
  world: MapPinned,
  mech: Gamepad2,
  scenario: Radiation,
  sound: FileAudio,
  minimap: Compass,
  console: Terminal,
  assistant: Bot,
  saves: Save,
  mechbuilder: Hammer,
  animations: Film,
};

const ZONE_LABEL: Record<DockZone, string> = {
  left: 'Слева',
  right: 'Справа',
  bottom: 'Снизу',
  center: 'В центре',
};

const DRAG_MIME = 'text/plain';
const SPLITTER_PX = 6;

export function OursMark({ className }: { className?: string }) {
  return (
    <span
      title="Наша функция — в Construct 3 такого нет"
      className={cn(
        'inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border border-emerald-400/60 bg-emerald-500/20 font-mono text-[8px] font-bold leading-none text-emerald-300',
        className,
      )}
    >
      W
    </span>
  );
}

function PanelTitle({ id, compact }: { id: PanelId; compact?: boolean }) {
  const def = PANELS[id];
  const Icon = PANEL_ICONS[id];
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Icon size={compact ? 11 : 13} className="shrink-0" />
      <span className="truncate">{def.title}</span>
      {def.origin === 'ours' && <OursMark />}
    </span>
  );
}

export interface WorkspaceProps {
  layout: DockLayout;
  onChange: (next: DockLayout) => void;
  renderPanel: (id: PanelId) => React.ReactNode;
  viewport: React.ReactNode;
  hiddenPanels?: PanelId[];
  hiddenZones?: ZoneId[];
  onEvent?: (line: string) => void;
}

export function Workspace({ layout, onChange, renderPanel, viewport, hiddenPanels = [], hiddenZones = [], onEvent }: WorkspaceProps) {
  const mainRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const emitRef = useRef(onEvent);
  emitRef.current = onEvent;
  const dragFrom = useRef<string>('-');
  const floatRefs = useRef(new Map<PanelId, HTMLDivElement>());

  const emit = (line: string) => emitRef.current?.(line);

  const box4 = (r: DOMRect) => `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`;

  const [overZone, setOverZone] = useState<ZoneId | null>(null);

  const tabKey = ZONES.map((z) => `${z}:${layout.active[z] ?? '-'}`).join(',');

  React.useEffect(() => {
    document.querySelectorAll<HTMLElement>('.wf-tabs [data-active="true"]').forEach((el) => {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [tabKey]);

  React.useEffect(() => {
    const box = mainRef.current?.getBoundingClientRect();
    emit(`workspace.mount win=${window.innerWidth}x${window.innerHeight} dpr=${window.devicePixelRatio} box=${box ? box4(box) : 'none'} sizes=${layoutRef.current.sizes.left}/${layoutRef.current.sizes.right}/${layoutRef.current.sizes.bottom} zones=L[${layoutRef.current.zones.left.join(',')}] R[${layoutRef.current.zones.right.join(',')}] B[${layoutRef.current.zones.bottom.join(',')}] C[${layoutRef.current.zones.center.join(',')}] floats=[${Object.keys(layoutRef.current.floats).join(',')}]`);
  }, []);

  React.useEffect(() => {
    let timer: number | undefined;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const box = mainRef.current?.getBoundingClientRect();
        emit(`win.resize win=${window.innerWidth}x${window.innerHeight} box=${box ? box4(box) : 'none'} sizes=${layoutRef.current.sizes.left}/${layoutRef.current.sizes.right}/${layoutRef.current.sizes.bottom}`);
      }, 250);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);

  const isVisible = (id: PanelId) => !hiddenPanels.includes(id);

  const setLayoutZone = (l: DockLayout, zone: DockZone, id: PanelId) => {
    const next = setActive(toggleCollapsed(l, zone), zone, id);
    onChange(next);
  };

  const attachDrag = (label: string, move: (ev: PointerEvent) => void, detail?: () => string) => {
    const t0 = performance.now();
    let moves = 0;
    const onMove = (ev: PointerEvent) => { moves += 1; move(ev); };
    const finish = (reason: string) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
      document.body.classList.remove('select-none');
      const ms = Math.round(performance.now() - t0);
      const extra = detail ? ` ${detail()}` : '';
      emit(`${label}.end moves=${moves} ms=${ms} via=${reason}${extra}`);
    };
    const onUp = () => finish('up');
    const onCancel = () => finish('pointercancel');
    const onBlur = () => finish('blur');
    document.body.classList.add('select-none');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
  };

  const onDrop = (e: React.DragEvent, zone: ZoneId, index?: number) => {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData(DRAG_MIME);
    setOverZone(null);
    if (!(ALL_PANEL_IDS as string[]).includes(raw)) {
      emit(`panel.drop.rejected data="${raw}" to=${zone}`);
      return;
    }
    emit(`panel.drop id=${raw} from=${dragFrom.current} to=${zone}[${index ?? 'end'}]`);
    const moved = movePanel(layoutRef.current, raw as PanelId, zone, index);
    onChange(zone === 'float' ? moved : setCollapsed(moved, zone, false));
  };

  const dropToFloat = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(DRAG_MIME);
    if (!(ALL_PANEL_IDS as string[]).includes(raw)) return;
    e.preventDefault();
    onChange(detach(layoutRef.current, raw as PanelId, {
      x: e.clientX - 210, y: e.clientY - 24, w: 420, h: 380,
    }));
    setOverZone(null);
  };

  const startSplitter = (e: React.PointerEvent, zone: 'left' | 'right' | 'bottom') => {
    e.preventDefault();
    const row = shellRef.current;
    const box = mainRef.current?.getBoundingClientRect();
    const shellBox = shellRef.current?.getBoundingClientRect();
    if (!row || !box) { emit('splitter.abort no-shell-box'); return; }
    const startSize = layoutRef.current.sizes[zone];
    // Высота/ширина РЯДА зависят от размера дока, поэтому потолок считаем от
    // стабильного размера оболочки: иначе лимит устаревает прямо во время тяги.
    const avail = zone === 'bottom'
      ? (shellBox?.height ?? box.height) - SPLITTER_PX
      : (shellBox?.width ?? box.width) - SPLITTER_PX;
    const grabX = e.clientX;
    const grabY = e.clientY;
    const grab = zone === 'bottom' ? grabY : grabX;
    const applyVar = (px: number) => shellRef.current?.style.setProperty(`--wf-${zone}`, `${Math.round(px)}px`);
    const splitterAt = zone === 'left' ? box.left + startSize
      : zone === 'right' ? box.right - startSize
        : box.bottom;
    emit(`splitter.down zone=${zone} at=${Math.round(grabX)},${Math.round(grabY)} size=${Math.round(startSize)} grab=${Math.round(grab - splitterAt)} avail=${Math.round(avail)} box=${box4(box)} target=${(e.target as HTMLElement).tagName.toLowerCase()}.${String((e.target as HTMLElement).className).split(' ').slice(0, 2).join('.')}`);
    let raw = startSize;
    attachDrag(
      `splitter zone=${zone}`,
      (ev) => {
        const point = zone === 'bottom' ? ev.clientY : ev.clientX;
        raw = dragSize(zone, startSize, grab, point);
        applyVar(setSize(layoutRef.current, zone, raw, avail).sizes[zone]);
      },
      () => {
        const committed = setSize(layoutRef.current, zone, raw, avail).sizes[zone];
        applyVar(committed);
        setTimeout(() => {
          onChange(setSize(layoutRef.current, zone, raw, avail));
          emit(`splitter.commit zone=${zone} raw=${Math.round(raw)} committed=${Math.round(committed)}`);
        }, 0);
        return `raw=${Math.round(raw)} preview=${Math.round(committed)} avail=${Math.round(avail)}`;
      },
    );
  };

  const startFloatDrag = (e: React.PointerEvent, id: PanelId) => {
    e.preventDefault();
    const rect = layoutRef.current.floats[id];
    const el = floatRefs.current.get(id);
    if (!rect || !el) { emit(`float.drag.abort id=${id} rect=${rect ? 'ok' : 'no-rect'} el=${el ? 'ok' : 'no-node'}`); return; }
    const startX = e.clientX;
    const startY = e.clientY;
    emit(`float.drag.down id=${id} at=${Math.round(startX)},${Math.round(startY)} rect=${Math.round(rect.x)},${Math.round(rect.y)},${Math.round(rect.w)},${Math.round(rect.h)}`);
    attachDrag(
      `float.drag id=${id}`,
      (ev) => {
        const next = { ...rect, x: rect.x + (ev.clientX - startX), y: rect.y + (ev.clientY - startY) };
        el.style.left = `${next.x}px`;
        el.style.top = `${next.y}px`;
      },
      () => {
        const finalX = rect.x + (parseFloat(el.style.left) - rect.x);
        const finalY = rect.y + (parseFloat(el.style.top) - rect.y);
        onChange(detach(layoutRef.current, id, { ...rect, x: finalX, y: finalY }));
        return `rect=${Math.round(finalX)},${Math.round(finalY)},${Math.round(rect.w)},${Math.round(rect.h)}`;
      },
    );
  };

  const startFloatResize = (e: React.PointerEvent, id: PanelId) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = layoutRef.current.floats[id];
    const el = floatRefs.current.get(id);
    if (!rect || !el) { emit(`float.resize.abort id=${id} rect=${rect ? 'ok' : 'no-rect'} el=${el ? 'ok' : 'no-node'}`); return; }
    const startX = e.clientX;
    const startY = e.clientY;
    emit(`float.resize.down id=${id} at=${Math.round(startX)},${Math.round(startY)} size=${Math.round(rect.w)},${Math.round(rect.h)}`);
    attachDrag(
      `float.resize id=${id}`,
      (ev) => {
        el.style.width = `${rect.w + (ev.clientX - startX)}px`;
        el.style.height = `${rect.h + (ev.clientY - startY)}px`;
      },
      () => {
        const w = parseFloat(el.style.width);
        const h = parseFloat(el.style.height);
        onChange(detach(layoutRef.current, id, { ...rect, w, h }));
        return `size=${Math.round(w)}x${Math.round(h)} limits=${FLOAT_LIMITS.w[0]}..${FLOAT_LIMITS.w[1]}x${FLOAT_LIMITS.h[0]}..${FLOAT_LIMITS.h[1]}`;
      },
    );
  };

  const renderDock = (zone: DockZone, side: 'left' | 'right' | 'bottom') => {
    const tabs = layout.zones[zone].filter(isVisible);
    const activeId = layout.active[zone] && tabs.includes(layout.active[zone]) ? layout.active[zone] : tabs[0] ?? null;
    const isBottom = side === 'bottom';
    const hidden = hiddenZones.includes(zone);
    const collapsed = layout.collapsed[zone] || hidden;
    const available = ALL_PANEL_IDS.filter((id) => isVisible(id) && !layout.zones[zone].includes(id));

if (collapsed && !hidden) {
      return (
        <div
          title="Свёрнутая зона — нажми на иконку, чтобы развернуть"
          onDoubleClick={() => onChange(setCollapsed(layout, zone, false))}
          className={cn(
            'flex shrink-0 items-center gap-1 border-white/[0.07] bg-[#171310]',
            isBottom ? 'h-[26px] w-full border-t px-1' : 'flex-col border-r px-1 py-1.5',
          )}
          style={isBottom ? undefined : { width: 28 }}
        >
          {tabs.map((id) => {
            const Icon = PANEL_ICONS[id];
            return (
              <button
                key={id}
                title={`${PANELS[id].title} — развернуть`}
                onClick={() => {
                  setLayoutZone(layout, zone, id);
                }}
                className={cn(
                  'flex shrink-0 items-center justify-center rounded text-stone-500 transition-colors hover:bg-white/10 hover:text-amber-300',
                  isBottom ? 'h-[20px] w-[24px]' : 'h-[24px] w-[24px]',
                )}
              >
                <Icon size={13} />
              </button>
            );
          })}
          <div className={cn(isBottom ? 'ml-auto' : 'mt-auto')} />
          <button
            title="Развернуть зону"
            onClick={() => { emit(`zone.expand zone=${zone}`); onChange(setCollapsed(layout, zone, false)); }}
            className={cn(
              'flex shrink-0 items-center justify-center rounded text-stone-500 transition-colors hover:bg-white/10 hover:text-amber-300',
              isBottom ? 'h-[20px] w-[26px]' : 'h-[24px] w-[24px]',
            )}
          >
            <span className="text-[10px] leading-none">{isBottom ? '▲' : side === 'left' ? '▶' : '◀'}</span>
          </button>
        </div>
      );
    }

    return (
      <div
        className={cn(
          'flex min-h-0 min-w-0 shrink-0 flex-col bg-[#12100c]',
          isBottom ? 'border-t border-white/[0.07]' : side === 'left' ? 'border-r border-white/[0.07]' : 'border-l border-white/[0.07]',
          hidden && 'hidden',
        )}
        style={isBottom
          ? { height: 'var(--wf-bottom, 200px)' }
          : { width: `var(--wf-${side}, 300px)` }}
      >
        <div
          className={cn('flex shrink-0 items-stretch border-b border-white/[0.07] bg-[#171310]', isBottom ? 'h-8' : 'h-9')}
          onDragOver={(e) => { e.preventDefault(); setOverZone(zone); }}
          onDrop={(e) => onDrop(e, zone)}
        >
          <div className="wf-tabs flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((id, i) => (
            <button
              key={id}
              data-active={activeId === id}
              draggable
              onDragStart={(e) => {
                dragFrom.current = `${zone}[${i}] id=${id}`;
                emit(`panel.dragstart id=${id} from=${zone}[${i}] at=${Math.round(e.clientX)},${Math.round(e.clientY)}`);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData(DRAG_MIME, id);
              }}
              onDragEnd={() => setOverZone(null)}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
              onDrop={(e) => onDrop(e, zone, i)}
              onClick={() => { emit(`tab.click id=${id} zone=${zone}`); onChange(setActive(layout, zone, id)); }}
              title={PANELS[id].c3Note}
              className={cn(
                'group flex select-none items-center gap-1.5 border-r border-white/[0.05] px-2.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
                activeId === id
                  ? 'bg-amber-500/[0.10] text-amber-300 shadow-[inset_0_-2px_0_0_rgba(255,154,60,0.85)]'
                  : 'text-stone-500 hover:bg-white/[0.04] hover:text-stone-300',
              )}
            >
              <GripVertical size={9} className="shrink-0 text-stone-700 group-hover:text-stone-500" />
              <PanelTitle id={id} compact />
            </button>
          ))}
          </div>

          <div className="flex shrink-0 items-center gap-0.5 border-l border-white/[0.05] px-1">
            {available.length > 0 && (
              <div className="group/add relative">
                <button
                  title={`Добавить панель в «${ZONE_LABEL[zone]}»`}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-amber-300"
                >
                  <Plus size={12} />
                </button>
                <div className="invisible absolute bottom-full right-0 z-50 mb-1 w-48 overflow-hidden rounded-md border border-white/15 bg-[#1a1610] opacity-0 shadow-xl transition-opacity group-hover/add:visible group-hover/add:opacity-100">
                  {available.map((id) => (
                    <button
                      key={id}
                      onClick={() => { emit(`zone.add id=${id} to=${zone}`); onChange(setCollapsed(movePanel(layout, id, zone), zone, false)); }}
                      className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[10px] text-stone-300 hover:bg-amber-500/15 hover:text-amber-200"
                    >
                      <PanelTitle id={id} compact />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <button
              title="Свернуть зону"
              onClick={() => {
                const sz = side === 'bottom' ? layout.sizes.bottom : layout.sizes[side];
                emit(`zone.collapse zone=${zone} size=${Math.round(sz)}`);
                onChange(toggleCollapsed(layout, zone));
              }}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-amber-300"
            >
              <span className="text-[9px]">{isBottom ? '▼' : side === 'left' ? '◀' : '▶'}</span>
            </button>
          </div>
        </div>

        {activeId && (
          <div
            className={cn('min-h-0 flex-1 overflow-y-auto', overZone === zone && 'ring-1 ring-inset ring-amber-400/60')}
            onDragOver={(e) => { e.preventDefault(); setOverZone(zone); }}
            onDragLeave={() => setOverZone((z) => (z === zone ? null : z))}
            onDrop={(e) => onDrop(e, zone)}
          >
            {renderPanel(activeId)}
          </div>
        )}
      </div>
    );
  };

  const centerTabs = layout.zones.center.filter(isVisible);
  const centerActive = layout.active.center && centerTabs.includes(layout.active.center) ? layout.active.center : centerTabs[0] ?? null;

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      ref={shellRef}
      style={{
        '--wf-left': `${layout.sizes.left}px`,
        '--wf-right': `${layout.sizes.right}px`,
        '--wf-bottom': `${layout.sizes.bottom}px`,
      } as React.CSSProperties}
    >
      <div className="flex min-h-0 flex-1" ref={mainRef}>
        {!hiddenZones.includes('left') && (
          <>
            {renderDock('left', 'left')}
            <div
              onPointerDown={(e) => startSplitter(e, 'left')}
              title="Потяни, чтобы изменить ширину"
              className="w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-white/10 transition-colors hover:bg-amber-500/80"
            />
          </>
        )}

        <div className="relative flex min-w-0 flex-1 flex-col bg-black">
          {centerActive && (
            <div
              className="flex max-h-[42%] min-h-0 flex-col border-b border-white/[0.07] bg-[#12100c]"
              onDragOver={(e) => { e.preventDefault(); setOverZone('center'); }}
              onDrop={(e) => onDrop(e, 'center')}
            >
              <div className="flex h-8 shrink-0 items-stretch border-b border-white/[0.07] bg-[#171310]">
                {centerTabs.map((id) => (
                  <button
                    key={id}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_MIME, id); }}
                    onDragEnd={() => setOverZone(null)}
                    onClick={() => onChange(setActive(layout, 'center', id))}
                    className={cn(
                      'flex select-none items-center gap-1.5 border-r border-white/[0.05] px-2.5 text-[10px] font-bold uppercase tracking-wider',
                      centerActive === id ? 'bg-amber-500/[0.10] text-amber-300' : 'text-stone-500 hover:text-stone-300',
                    )}
                  >
                    <GripVertical size={9} className="text-stone-700" />
                    <PanelTitle id={id} compact />
                    <span
                      onClick={(e) => { e.stopPropagation(); onChange(closePanel(layout, id, 'right')); }}
                      className="ml-1 text-stone-600 hover:text-red-400"
                    >
                      <X size={10} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{renderPanel(centerActive)}</div>
            </div>
          )}

          <div className="relative min-h-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={dropToFloat}>
            {viewport}
          </div>
        </div>

        {!hiddenZones.includes('right') && (
          <>
            <div
              onPointerDown={(e) => startSplitter(e, 'right')}
              title="Потяни, чтобы изменить ширину"
              className="w-1.5 shrink-0 cursor-col-resize touch-none select-none bg-white/10 transition-colors hover:bg-amber-500/80"
            />
            {renderDock('right', 'right')}
          </>
        )}
      </div>

      {!hiddenZones.includes('bottom') && (
        <>
          <div
            onPointerDown={(e) => startSplitter(e, 'bottom')}
            title="Потяни, чтобы изменить высоту"
            className="h-1.5 shrink-0 cursor-row-resize touch-none select-none bg-white/10 transition-colors hover:bg-amber-500/80"
          />
          {renderDock('bottom', 'bottom')}
        </>
      )}

      {Object.entries(layout.floats).map(([key, rect]) => {
        const id = key as PanelId;
        if (!isVisible(id)) return null;
        const Icon = PANEL_ICONS[id];
        return (
          <div
            key={id}
            ref={(el) => { if (el) floatRefs.current.set(id, el); else floatRefs.current.delete(id); }}
            className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-white/15 bg-[#12100c]/95 shadow-[0_18px_50px_rgba(0,0,0,0.65)] backdrop-blur"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          >
            <div
              onPointerDown={(e) => startFloatDrag(e, id)}
              className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 border-b border-white/10 bg-[#1d1913] px-2 active:cursor-grabbing"
            >
              <Icon size={12} className="shrink-0 text-amber-400" />
              <span className="truncate text-[10px] font-bold uppercase tracking-wider text-stone-200">{PANELS[id].title}</span>
              {PANELS[id].origin === 'ours' && <OursMark />}
              <div className="ml-auto flex items-center gap-0.5" onPointerDown={(e) => e.stopPropagation()}>
                {(['left', 'right', 'bottom', 'center'] as DockZone[]).map((z) => (
                  <button
                    key={z}
                    title={`Прикрепить: ${ZONE_LABEL[z]}`}
                    onClick={() => { emit(`float.dock id=${id} to=${z}`); onChange(setCollapsed(movePanel(layout, id, z), z, false)); }}
                    className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-white/10 hover:text-amber-300"
                  >
                    <LayoutPanelTop size={11} />
                  </button>
                ))}
                <button
                  title="Закрыть панель"
                  onClick={() => onChange(closePanel(layout, id, 'right'))}
                  className="flex h-6 w-6 items-center justify-center rounded text-stone-500 hover:bg-red-500/15 hover:text-red-300"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{renderPanel(id)}</div>
            <div
              onPointerDown={(e) => startFloatResize(e, id)}
              className="absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize border-b-2 border-r-2 border-amber-500/40"
            />
          </div>
        );
      })}
    </div>
  );
}