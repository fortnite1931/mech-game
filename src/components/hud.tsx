import React from 'react';
import { Square, Eye, Crosshair, Flame, Gauge, Rocket, Keyboard, Shield, RotateCcw, LogIn, LogOut, Bot } from 'lucide-react';
import type { HudState, MechConfig, ViewMode, VisionMode } from '../three/playTypes.ts';
import { VIEW_ORDER, VIEW_INFO, VISION_ORDER, VISION_INFO } from '../three/playTypes.ts';
import { Minimap } from './overlays.tsx';
import { BuildDock, type BuildTab } from './buildDock.tsx';
import type { SceneObjectState } from '../three/EditorEngine.ts';
import { cn } from '../utils/cn.ts';

const wrapDeg = (a: number) => ((a + 180) % 360 + 360) % 360 - 180;

function Compass({ heading, color }: { heading: number; color: string }) {
  const marks: { a: number; l: string }[] = [];
  for (let a = 0; a < 360; a += 15) marks.push({ a, l: a === 0 ? 'N' : a === 90 ? 'E' : a === 180 ? 'S' : a === 270 ? 'W' : a % 45 === 0 ? String(a) : '' });
  return (
    <div className="relative h-8 w-64 overflow-hidden rounded border bg-black/55" style={{ borderColor: color + '55' }}>
      {marks.map((m) => {
        const d = wrapDeg(m.a - heading);
        if (Math.abs(d) > 60) return null;
        const x = 128 + d * 2.1;
        return (
          <div key={m.a} className="absolute top-0 flex flex-col items-center" style={{ left: x, transform: 'translateX(-50%)' }}>
            <div style={{ background: color, width: 1, height: m.l ? 8 : 4, opacity: 0.8 }} />
            {m.l && <span className="font-mono text-[9px] font-bold" style={{ color }}>{m.l}</span>}
          </div>
        );
      })}
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2" style={{ background: color }} />
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 font-mono text-[10px] font-black" style={{ color }}>{Math.round(heading).toString().padStart(3, '0')}°</div>
    </div>
  );
}

export function CockpitFrame({ opacity, scanlines, color }: { opacity: number; scanlines: boolean; color: string }) {
  return (
    <>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ opacity }}>
        <defs>
          <linearGradient id="strut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a1612" /><stop offset="1" stopColor="#060504" />
          </linearGradient>
          <radialGradient id="glass" cx="50%" cy="40%" r="70%">
            <stop offset="0" stopColor={color} stopOpacity="0" /><stop offset="0.75" stopColor={color} stopOpacity="0.03" /><stop offset="1" stopColor="#000" stopOpacity="0.55" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="100" height="100" fill="url(#glass)" />
        {/* corner struts */}
        <polygon points="0,0 22,0 0,16" fill="url(#strut)" />
        <polygon points="100,0 78,0 100,16" fill="url(#strut)" />
        <polygon points="0,100 0,72 10,70 24,88 76,88 90,70 100,72 100,100" fill="url(#strut)" />
        <polygon points="0,16 0,72 3.2,70 3.2,20" fill="#0a0806" />
        <polygon points="100,16 100,72 96.8,70 96.8,20" fill="#0a0806" />
        <polygon points="22,0 25,0 4.6,21 3.2,20" fill="#0b0907" />
        <polygon points="78,0 75,0 95.4,21 96.8,20" fill="#0b0907" />
        {/* top center bar */}
        <polygon points="40,0 60,0 58,3 42,3" fill="#0a0806" />
        {/* rivets */}
        {[12, 18, 82, 88].map((x) => <circle key={x} cx={x} cy={1.6} r={0.35} fill="#3a322a" />)}
        {[30, 40, 50, 60, 70].map((x) => <circle key={x} cx={x} cy={89.5} r={0.35} fill="#3a322a" />)}
        {/* glass edge highlight */}
        <polyline points="3.2,20 24,0" stroke={color} strokeOpacity="0.25" strokeWidth="0.25" fill="none" />
        <polyline points="96.8,20 76,0" stroke={color} strokeOpacity="0.25" strokeWidth="0.25" fill="none" />
        <polyline points="10,70 24,88 76,88 90,70" stroke={color} strokeOpacity="0.3" strokeWidth="0.25" fill="none" />
      </svg>
      {scanlines && (
        <div className="absolute inset-0" style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0 1px, transparent 1px 3px)', opacity: 0.8 }} />
      )}
      <div className="absolute inset-0" style={{ boxShadow: 'inset 0 0 140px 30px rgba(0,0,0,0.6)' }} />
    </>
  );
}

export function PlayHUD({ hud, config, objects, reticleRef, onExit, onRestart, onView, onVision, onEject, onEnterMech, mechs, onCraft, onUseMedkit, onRefreshCraft, craftOptions, onBuild, onScreenshot }: {
  hud: HudState | null; config: MechConfig; objects: SceneObjectState[];
  reticleRef: React.RefObject<HTMLDivElement | null>;
  onExit: () => void; onRestart: () => void; onView: (v: ViewMode) => void; onVision: (v: VisionMode) => void;
  onEject: () => void; onEnterMech: (id: string) => void; mechs: { id: string; name: string; assetId: string }[];
  /** Крафт меха из деталей (данные из PlayController). */
  onCraft?: (recipeId: string) => void;
  onUseMedkit?: () => void;
  onRefreshCraft?: () => void;
  craftOptions?: { id: string; name: string; desc: string; ok: boolean; missing: string }[];
  /** Стройка базы: построить объект по kind (данные из PlayController). */
  onBuild?: (kind: string) => void;
  /** Сделать скриншот игры в PNG (для диагностики дизайна/багов). */
  onScreenshot?: () => void;
}) {
  const color = config.hudColor;
  const view = hud?.view ?? config.defaultView;
  const ejected = hud?.ejected ?? false;
  const vision = hud?.vision ?? config.defaultVision;
  const heat = hud?.heat ?? 0;
  const heatColor = hud?.overheated ? '#ff4040' : heat > 75 ? '#ffb040' : color;
  const php = hud?.php ?? 0;
  const pmax = Math.max(1, hud?.pmax ?? 1);
  const hpFrac = Math.max(0, Math.min(1, php / pmax));
  const [tab, setTab] = React.useState<BuildTab>('build');
  // клавиши — только быстрые переключатели вкладок нижнего дока
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'KeyB') { e.preventDefault(); setTab('craft'); onRefreshCraft?.(); }
      if (e.code === 'KeyT') { e.preventDefault(); setTab('build'); }
      if (e.code === 'KeyI') { e.preventDefault(); setTab('inv'); }
      if (e.code === 'KeyH') { e.preventDefault(); onUseMedkit?.(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onRefreshCraft, onUseMedkit]);
  const timeStr = hud ? `${Math.floor(hud.time / 60).toString().padStart(2, '0')}:${Math.floor(hud.time % 60).toString().padStart(2, '0')}` : '00:00';
  const recipes = craftOptions ?? [];

  return (
    <div className="pointer-events-none absolute inset-0 select-none overflow-hidden" style={{ color }}>
      {view === 'cockpit' && <CockpitFrame opacity={config.cockpit.frameOpacity} scanlines={config.cockpit.scanlines} color={color} />}

      {!ejected && (
        <>
          {/* reticle (positioned imperatively) */}
          <div ref={reticleRef} className="absolute left-1/2 top-1/2" style={{ transform: 'translate(-50%,-50%)', transition: 'opacity 0.15s' }}>
        <svg width="52" height="52" viewBox="-26 -26 52 52" fill="none" stroke={hud?.target ? '#ff6a4a' : color} strokeWidth="1.5">
          <circle r="15" strokeOpacity="0.8" />
          <circle r="2" fill={hud?.target ? '#ff6a4a' : color} stroke="none" />
          <line x1="-24" y1="0" x2="-17" y2="0" /><line x1="24" y1="0" x2="17" y2="0" />
          <line x1="0" y1="-24" x2="0" y2="-17" /><line x1="0" y1="24" x2="0" y2="17" />
          {hud?.target && <rect x="-21" y="-21" width="42" height="42" strokeDasharray="8 26" strokeOpacity="0.9" />}
        </svg>
        {hud?.target && (
          <div className="absolute left-8 top-7 whitespace-nowrap rounded border border-red-400/50 bg-black/70 px-2 py-1 text-[10px] font-bold text-red-200">
            {hud.target.name}
            <div className="mt-0.5 h-1 w-24 rounded bg-white/15"><div className="h-full rounded bg-red-400" style={{ width: `${Math.max(2, hud.target.hp * 100)}%` }} /></div>
          </div>
        )}
      </div>
      {/* текущая зона карты: цель зачистки */}
      {hud?.zone && (
        <div className="absolute left-1/2 top-[7%] -translate-x-1/2 rounded border border-amber-500/40 bg-black/75 px-3 py-1.5 text-center backdrop-blur">
          <div className="text-[11px] font-bold text-amber-200">{hud.zone.name}</div>
          <div className="font-mono text-[10px] text-stone-400">Врагов в зоне: {hud.zone.left}</div>
        </div>
      )}
      {view === 'cockpit' && !ejected && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-60">
          <svg width="120" height="120" viewBox="-60 -60 120 120" fill="none" stroke={color} strokeWidth="1">
            <path d="M-50,0 L-30,0 M50,0 L30,0 M0,-50 L0,-30 M0,50 L0,30" strokeOpacity="0.5" />
            <path d="M-12,-12 L-12,-20 L-20,-20 M12,-12 L12,-20 L20,-20 M-12,12 L-12,20 L-20,20 M12,12 L12,20 L20,20" strokeOpacity="0.8" />
          </svg>
        </div>
      )}
        </>
      )}

      {ejected && (
        <>
          {/* подсказка: где ближайший мех и можно ли сесть */}
          {hud?.nearestMech && (
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded border border-amber-500/40 bg-black/75 px-2.5 py-1 text-center backdrop-blur">
              <div className="text-[10px] font-bold text-amber-200">{hud.nearestMech.name}</div>
              <div className="font-mono text-[9px] text-stone-400">
                {Math.round(hud.nearestMech.dist)} м · ЛКМ — сесть · F — вернуться в свой
              </div>
            </div>
          )}
          {/* выносливость */}
          <div className="absolute left-1/2 bottom-6 w-[260px] -translate-x-1/2">
            <div className="mb-1 flex justify-between font-mono text-[9px] uppercase tracking-wider text-stone-400">
              <span>Выносливость</span>
              <span>{Math.round((hud?.stamina ?? 1) * 100)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-sm border border-white/20 bg-black/60">
              <div
                className="h-full transition-all"
                style={{
                  width: `${Math.max(0, Math.min(1, hud?.stamina ?? 1)) * 100}%`,
                  background: (hud?.stamina ?? 1) < 0.2 ? '#ff7a40' : '#7cd4ff',
                }}
              />
            </div>
          </div>

        </>
      )}

      {/* подсказка о ближайшем луте (над доком) */}
      {hud?.nearLoot && !hud.buildMode && (
        <div className="absolute bottom-[118px] left-3 rounded border border-amber-500/40 bg-black/75 px-2.5 py-1 text-[10px] text-amber-200 backdrop-blur">
          🎒 Рядом: {hud.nearLoot} — подойди, чтобы подобрать
        </div>
      )}

      {/* подсказка режима размещения */}
      {hud?.buildMode && (
        <div className="absolute bottom-[118px] left-1/2 -translate-x-1/2 rounded border border-amber-400/60 bg-black/85 px-3 py-1.5 text-[11px] text-amber-200 backdrop-blur">
          Размещение: клик <b className="text-white">ЛКМ</b> — построить · <b className="text-white">ПКМ/Esc</b> — отмена
        </div>
      )}

      {/* постоянный нижний док: стройка/техника/инвентарь */}
      <BuildDock
        bag={hud?.bag}
        buildOptions={hud?.buildOptions ?? []}
        craftOptions={recipes}
        activeTab={tab}
        onTab={setTab}
        onBuild={onBuild}
        onCraft={(id) => { onCraft?.(id); onRefreshCraft?.(); }}
        activeKind={hud?.buildMode}
      />

      {/* top-left: status */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded border bg-black/70 px-2.5 py-1.5 backdrop-blur" style={{ borderColor: color + '66' }}>
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px_#f00]" />
            <span className="text-[11px] font-black uppercase tracking-[0.2em]">Превью</span>
            <span className="font-mono text-[10px] opacity-70">{hud ? `${Math.floor(hud.time / 60).toString().padStart(2, '0')}:${Math.floor(hud.time % 60).toString().padStart(2, '0')}` : '00:00'}</span>
          </div>
          <button onClick={onExit} className="pointer-events-auto flex items-center gap-1.5 rounded border border-red-500/60 bg-red-950/80 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider text-red-200 backdrop-blur hover:bg-red-900/80">
            <Square size={11} fill="currentColor" /> Стоп <span className="font-mono text-[9px] opacity-60">Esc</span>
          </button>
          {onScreenshot && (
            <button
              onClick={onScreenshot}
              title="Снимок экрана (диагностика UI)"
              className="pointer-events-auto flex items-center gap-1.5 rounded border border-white/20 bg-black/70 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-stone-300 backdrop-blur hover:border-amber-400/60 hover:text-amber-300"
            >
              📷 Снимок
            </button>
          )}
          {!ejected && (
            <button onClick={onEject}
              className="pointer-events-auto flex items-center gap-1.5 rounded border border-amber-500/60 bg-amber-950/80 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider text-amber-200 backdrop-blur hover:bg-amber-900/80"
              title="Покинуть кабину (F) — пойти пешком или сесть в другой мех">
              <LogOut size={12} /> Выйти <span className="font-mono text-[9px] opacity-60">F</span>
            </button>
          )}
          {ejected && (
            <button onClick={() => onEnterMech('__own__')}
              className="pointer-events-auto flex items-center gap-1.5 rounded border border-emerald-500/60 bg-emerald-950/80 px-2.5 py-1.5 text-[11px] font-black uppercase tracking-wider text-emerald-200 backdrop-blur hover:bg-emerald-900/80"
              title="Вернуться в свой мех (F)">
              <LogIn size={12} /> В свой мех <span className="font-mono text-[9px] opacity-60">F</span>
            </button>
          )}
        </div>
        {ejected && (
          <div className="pointer-events-auto max-w-[300px] rounded border border-sky-500/50 bg-black/75 px-2.5 py-1.5 text-[10px] backdrop-blur">
            <div className="mb-1 font-bold uppercase tracking-wider text-sky-200">Пилот на земле</div>
            <div className="mb-1 text-[9px] text-stone-400">WASD — идти · мышь — обзор · <b className="text-sky-200">ЛКМ по меху</b> — сесть за руль</div>
            <div className="flex flex-wrap gap-1">
              {mechs.slice(0, 6).map((m) => (
                <button key={m.id} onClick={() => onEnterMech(m.id)}
                  className="rounded border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-bold text-sky-100 transition hover:bg-sky-500/35">
                  {m.name}
                </button>
              ))}
              {mechs.length === 0 && <span className="text-stone-500">В сцене нет других мехов</span>}
            </div>
          </div>
        )}
        <div className="rounded border bg-black/60 px-2.5 py-1.5 text-[10px] backdrop-blur" style={{ borderColor: color + '44' }}>
          <div className="font-black tracking-wider">{hud?.chassisName ?? '—'}</div>
          <div className="opacity-70">{VIEW_INFO[view].label} · {VISION_INFO[vision].label}</div>
          <div className="mt-1 flex items-center gap-1.5">
            <Shield size={10} className="opacity-70" />
            <div className="h-2 w-28 overflow-hidden rounded-sm border" style={{ borderColor: color + '66' }}>
              <div className="h-full transition-all" style={{ width: `${hpFrac * 100}%`, background: hpFrac > 0.35 ? color : '#ff5040' }} />
            </div>
            <span className="font-mono text-[10px] font-bold">{php}/{pmax}</span>
          </div>
          {hud?.mechMaxHp ? (
            <div className="mt-1 flex items-center gap-1.5">
              <Bot size={10} className="opacity-70" />
              <div className="h-1.5 w-28 overflow-hidden rounded-sm border" style={{ borderColor: color + '44' }}>
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.max(0, Math.min(1, (hud.mechHp ?? 0) / hud.mechMaxHp)) * 100}%`,
                    background: (hud.mechHp ?? 0) / hud.mechMaxHp > 0.35 ? '#8fb8ff' : '#ff8040',
                  }}
                />
              </div>
              <span className="font-mono text-[9px] opacity-80">броня {hud.mechHp}/{hud.mechMaxHp}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* top-center: view / vision switch */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-1">
        <div className="pointer-events-auto flex gap-0.5 rounded border bg-black/70 p-0.5 backdrop-blur" style={{ borderColor: color + '55' }}>
          <span className="flex items-center px-1.5 opacity-60"><Eye size={11} /></span>
          {VIEW_ORDER.map((v) => (
            <button key={v} onClick={() => onView(v)}
              className={cn('rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all', view === v ? 'bg-white/15' : 'opacity-60 hover:opacity-100')}
              style={view === v ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}>
              {VIEW_INFO[v].label}
            </button>
          ))}
          <span className="mx-1 w-px bg-white/15" />
          {VISION_ORDER.map((v) => (
            <button key={v} onClick={() => onVision(v)}
              className={cn('rounded px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-all', vision === v ? 'bg-white/15' : 'opacity-60 hover:opacity-100')}
              style={vision === v ? { boxShadow: `inset 0 -2px 0 ${color}` } : undefined}>
              {v === 'normal' ? 'Обычн.' : v === 'night' ? 'ПНВ' : 'Тепло'}
            </button>
          ))}
        </div>
        <div className="font-mono text-[9px] opacity-50">V — вид · N — режим зрения</div>
      </div>

      {/* top-right: minimap + log */}
      <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
        <Minimap
          objects={objects}
          selectedId={null}
          onSelect={() => undefined}
          center={hud ? { x: hud.pos[0], z: hud.pos[1], yaw: hud.yaw, isPlayer: true } : null}
        />
        <div className="w-[168px] rounded border bg-black/60 px-2 py-1.5 font-mono text-[9px] leading-relaxed backdrop-blur" style={{ borderColor: color + '44' }}>
          <div className="mb-0.5 flex justify-between font-bold opacity-80">
            <span>ЦЕЛЕЙ: {hud?.targetsLeft ?? '—'}</span><span>УНИЧТ.: {hud?.kills ?? 0}</span>
          </div>
          {(hud?.wavesTotal ?? 0) > 0 && (
            <div className="mb-0.5 flex justify-between font-bold text-amber-200/90">
              <span>ВОЛНА: {hud?.wave ?? 0}/{hud?.wavesTotal ?? 0}</span><span>ВРАГОВ: {hud?.enemiesLeft ?? 0}</span>
            </div>
          )}
          {(hud?.log ?? []).map((l, i) => (
            <div key={i} className={cn('truncate', i === 0 ? 'opacity-100' : 'opacity-50', l.includes('ПЕРЕГРЕВ') && 'text-red-300')}>{l}</div>
          ))}
        </div>
      </div>

      {/* bottom-left: speed / compass / jets */}
      <div className={cn('absolute flex flex-col gap-2', view === 'cockpit' ? 'bottom-[7%] left-[5%]' : 'bottom-3 left-3')}>
        <Compass heading={hud?.heading ?? 0} color={color} />
        <div className="flex items-end gap-3 rounded border bg-black/60 px-3 py-2 backdrop-blur" style={{ borderColor: color + '44' }}>
          <div>
            <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest opacity-70"><Gauge size={10} /> Скорость</div>
            <div className="font-mono text-3xl font-black leading-none">{Math.round(hud?.speedKmh ?? 0)}<span className="ml-1 text-[10px] font-bold opacity-60">км/ч</span></div>
          </div>
          <div className="flex h-10 w-3 flex-col justify-end overflow-hidden rounded-sm border" style={{ borderColor: color + '66' }}>
            <div style={{ height: `${Math.min(100, Math.abs(hud?.throttle ?? 0) * 100)}%`, background: (hud?.throttle ?? 0) < 0 ? '#ffb040' : color }} />
          </div>
          <div className="ml-1 flex flex-col gap-1">
            <div className="text-[9px] font-bold uppercase tracking-widest opacity-70">Торс</div>
            <svg width="44" height="24" viewBox="-22 -22 44 24">
              <path d="M-20,0 A20,20 0 0 1 20,0" fill="none" stroke={color} strokeOpacity="0.35" strokeWidth="2" />
              <line x1="0" y1="0" x2={Math.sin(((hud?.torsoOffsetDeg ?? 0) * Math.PI) / 180) * -18} y2={-Math.cos(((hud?.torsoOffsetDeg ?? 0) * Math.PI) / 180) * 18} stroke={color} strokeWidth="2" />
            </svg>
          </div>
          {hud?.hasJets && (
            <div className="ml-1">
              <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest opacity-70"><Rocket size={10} /> Jets</div>
              <div className="mt-1 h-2 w-16 overflow-hidden rounded-sm border" style={{ borderColor: color + '66' }}>
                <div className="h-full" style={{ width: `${hud.jetFuel}%`, background: hud.airborne ? '#7ac8ff' : color }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* bottom-right: weapons + heat (только в кабине — на земле оружия нет) */}
      {!ejected && (
      <div className={cn('absolute flex items-end gap-2', view === 'cockpit' ? 'bottom-[7%] right-[5%]' : 'bottom-3 right-3')}>
        <div className="flex flex-col items-center gap-1 rounded border bg-black/60 px-2 py-2 backdrop-blur" style={{ borderColor: heatColor + '66' }}>
          <Flame size={12} style={{ color: heatColor }} className={hud?.overheated ? 'animate-pulse' : ''} />
          <div className="flex h-24 w-3 flex-col justify-end overflow-hidden rounded-sm border" style={{ borderColor: heatColor + '66' }}>
            <div style={{ height: `${heat}%`, background: `linear-gradient(to top, ${color}, #ffb040 60%, #ff4040)` }} />
          </div>
          <span className="font-mono text-[9px] font-bold" style={{ color: heatColor }}>{Math.round(heat)}</span>
        </div>
        <div className="w-[230px] rounded border bg-black/65 p-1.5 backdrop-blur" style={{ borderColor: color + '55' }}>
          <div className="mb-1 flex items-center justify-between px-1 text-[9px] font-bold uppercase tracking-widest opacity-70">
            <span className="flex items-center gap-1"><Crosshair size={10} /> Вооружение</span>
            <span>ЛКМ · ПКМ залп</span>
          </div>
          {(hud?.weapons ?? config.weapons.map((id, i) => ({ slot: i, id, name: id, short: id, ammo: null, ready: 1, selected: i === 0 }))).map((w) => (
            <div key={w.slot} className={cn('relative mb-0.5 flex items-center gap-2 overflow-hidden rounded px-1.5 py-1', w.selected ? 'bg-white/15' : w.id === 'none' ? 'opacity-30' : 'opacity-70')}
              style={w.selected ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
              <span className="w-4 font-mono text-[10px] font-black">{w.slot + 1}</span>
              <span className="flex-1 truncate text-[11px] font-bold">{w.name}</span>
              <span className="font-mono text-[10px]">{w.ammo === null ? (w.id === 'none' ? '' : '∞') : w.ammo}</span>
              <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${w.ready * 100}%`, background: w.ready >= 1 ? color : '#ffb040', opacity: 0.8 }} />
            </div>
          ))}
        </div>
      </div>
      )}

      {/* overheat warning */}
      {hud?.overheated && (
        <div className="absolute left-1/2 top-[28%] -translate-x-1/2 animate-pulse rounded border-2 border-red-500 bg-red-950/80 px-6 py-2 text-center">
          <div className="text-[18px] font-black uppercase tracking-[0.3em] text-red-300">Перегрев</div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-red-200/70">Аварийное отключение реактора</div>
        </div>
      )}

      {/* hurt vignette */}
      {(hud?.hurt ?? 0) > 0 && (
        <div className="absolute inset-0"
          style={{ boxShadow: 'inset 0 0 120px 40px rgba(255,30,20,0.55)', opacity: Math.min(1, hud?.hurt ?? 0) }} />
      )}

      {/* win / lose overlay */}
      {hud?.over && (
        <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60">
          <div className="rounded-xl border bg-black/85 px-10 py-8 text-center backdrop-blur" style={{ borderColor: color + '66' }}>
            <div className="text-3xl font-black uppercase tracking-[0.25em]"
              style={{ color: hud.over === 'won' ? '#7cf5b0' : '#ff5040' }}>
              {hud.over === 'won' ? 'Победа' : 'Поражение'}
            </div>
            <div className="mt-2 font-mono text-[11px] opacity-70">
              Уничтожено: {hud.kills} · Выстрелов: {hud.shots} · Время: {timeStr}
            </div>
            <div className="mt-5 flex justify-center gap-2">
              <button onClick={onRestart}
                className="flex items-center gap-1.5 rounded border border-emerald-500/60 bg-emerald-950/80 px-4 py-2 text-[12px] font-black uppercase tracking-wider text-emerald-200 hover:bg-emerald-900/80">
                <RotateCcw size={13} /> В бой снова
              </button>
              <button onClick={onExit}
                className="flex items-center gap-1.5 rounded border border-white/20 bg-white/[0.05] px-4 py-2 text-[12px] font-black uppercase tracking-wider text-stone-300 hover:bg-white/10">
                В редактор
              </button>
            </div>
          </div>
        </div>
      )}

      {/* bottom-center: controls */}
      {(hud?.showHelp ?? true) && (
        <div className={cn('absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded border bg-black/70 px-3 py-1.5 font-mono text-[10px] backdrop-blur', view === 'cockpit' ? 'bottom-[2%]' : 'bottom-3')} style={{ borderColor: color + '44' }}>
          <Keyboard size={11} className="opacity-60" />
          {[['WASD', 'ход/поворот'], ['Shift', 'форсаж'], ['Space', 'джеты'], ['СКМ↓', 'камера'], ['колесо', 'зум'], ['ЛКМ', 'огонь'], ['ПКМ', 'залп'], ['1-4/Tab', 'оружие'], ['C', 'центр'], ['H', 'аптечка'], ['F1', 'скрыть']].map(([k, v]) => (
            <span key={k}><b className="rounded bg-white/15 px-1 py-0.5">{k}</b> <span className="opacity-70">{v}</span></span>
          ))}
        </div>
      )}
    </div>
  );
}
