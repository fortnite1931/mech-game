import React from 'react';
import {
  Radiation, Move, RotateCw, Scaling, Magnet, LayoutGrid, Undo2, Redo2,
  Copy, Trash2, Focus, ArrowDownToLine, Download, Camera,
  HelpCircle, MousePointer2, Plus, Save, FolderOpen, Video, Play, Square, Gamepad2, BoxSelect, X, ListTree, Pencil, Hammer, Gauge,
} from 'lucide-react';
import { EditorEngine, DEFAULT_ENV } from './three/EditorEngine.ts';
import type { SceneObjectState, EnvState, EngineStats } from './three/EditorEngine.ts';
import { DEFAULT_MECH_CONFIG, DEFAULT_SCENARIO, mergeMechConfig } from './three/playTypes.ts';
import type { MechConfig, HudState, Scenario } from './three/playTypes.ts';
import { ScenarioPanel } from './components/scenario.tsx';
import { WorldPanel } from './components/worldPanel.tsx';
import { AssetPalette, Hierarchy } from './components/palette.tsx';
import { Inspector, EnvironmentPanel } from './components/inspector.tsx';
import { EffectsPanel } from './components/fxPanel.tsx';
import { audio } from './three/audio.ts';
import { perf } from './three/perfLog.ts';
import { TypesPanel } from './components/typesPanel.tsx';
import { SheetsPanel } from './components/sheetsPanel.tsx';
import { ProjectPanel } from './components/projectPanel.tsx';import { SoundPanel } from './components/soundPanel.tsx';
import { ExportModal, Minimap, StatusBar } from './components/overlays.tsx';
import { MechPanel } from './components/mechPanel.tsx';
import { AssistantPanel } from './components/assistantPanel.tsx';
import { SavesPanel } from './components/savesPanel.tsx';
import { ScreenshotTool } from './components/screenshotTool.tsx';
import { MechBuilderPanel } from './components/mechBuilderPanel.tsx';
import AnimationsPanel from './components/animationsPanel.tsx';
import {
  defaultMechSpec,
  type BrushMode, type BrushSettings, type MechSpec, type PartId,
} from './three/mechRig.ts';
import { PlayHUD, CockpitFrame } from './components/hud.tsx';
import { IconBtn, Btn, Modal, Toasts } from './components/ui.tsx';
import type { ToastMsg } from './components/ui.tsx';
import { Workspace, OursMark } from './components/workspace.tsx';
import { MenuBar, type MenuDef } from './components/menubar.tsx';
import { PANELS, ALL_PANEL_IDS, type PanelId } from './editor/panels.ts';
import {
  deleteProject, listProjects, loadAutosave, loadProject, saveAutosave, saveProject,
  type StoredProject,
} from './game/projectStore.ts';
import { loadDynamicAssets, saveDynamicAssets, bytesToBase64 } from './utils/dynamicAssetsStore.ts';
import { normalizeScenario } from './game/project.ts';
import {
  loadLayout, saveLayout, setActive, movePanel, resetLayout, setCollapsed,
  type DockLayout, type ZoneId,
} from './editor/dockLayout.ts';
import { cn } from './utils/cn.ts';

function loadMechConfig(): MechConfig {
  try {
    const raw = localStorage.getItem('wf_mech_config');
    if (raw) return mergeMechConfig(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_MECH_CONFIG };
}

function loadScenario(): Scenario {
  try {
    const raw = localStorage.getItem('wf_scenario');
    if (raw) return normalizeScenario(JSON.parse(raw));
  } catch { /* ignore */ }
  return JSON.parse(JSON.stringify(DEFAULT_SCENARIO)) as Scenario;
}

function download(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

interface LogLine { t: string; text: string; kind: 'ok' | 'err' | 'info'; }

function ConsolePanel({ lines, onCopy, onClear }: {
  lines: LogLine[]; onCopy: () => void; onClear: () => void;
}) {
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <div className="flex h-full min-h-full flex-col font-mono text-[10px] text-stone-400">
      <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.06] px-2 py-1">
        <span className="text-stone-500">событий: {lines.length}</span>
        <div className="ml-auto flex gap-1">
          <Btn onClick={onCopy} title="Скопировать весь журнал (пришли мне — разберу)">Копировать лог</Btn>
          <Btn variant="danger" onClick={onClear} title="Очистить журнал">Очистить</Btn>
        </div>
      </div>
      <div ref={boxRef} className="min-h-0 flex-1 overflow-y-auto p-2">
        {lines.length === 0 ? <span className="text-stone-600">Журнал пуст. Тяни границы панелей — здесь появятся события раскладки.</span> : lines.map((l, i) => (
          <div key={i} className="flex gap-2 border-b border-white/[0.04] py-0.5">
            <span className="shrink-0 text-stone-600">{l.t}</span>
            <span className={cn('break-all', l.kind === 'ok' && 'text-emerald-400', l.kind === 'err' && 'text-red-400', l.kind === 'info' && 'text-stone-300')}>{l.text}</span>
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-white/[0.07] p-1.5 text-stone-600">
        окно {typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '—'} · журнал пишет только действия с панелями, без шума от мыши
      </div>
    </div>
  );
}

export default function App() {
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<EditorEngine | null>(null);
  const [ready, setReady] = React.useState(false);
  const [objects, setObjects] = React.useState<SceneObjectState[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [env, setEnv] = React.useState<EnvState>({ ...DEFAULT_ENV });
  const [stats, setStats] = React.useState<EngineStats>({ fps: 60, tris: 0, calls: 0, objects: 0 });
  const [placingId, setPlacingId] = React.useState<string | null>(null);
  const placingRef = React.useRef<string | null>(null);
  const [mode, setMode] = React.useState<'translate' | 'rotate' | 'scale'>('translate');
  const [layout, setLayoutState] = React.useState<DockLayout>(loadLayout);
  const [mechConfig, setMechConfig] = React.useState<MechConfig>(loadMechConfig);
  const [scenario, setScenario] = React.useState<Scenario>(loadScenario);
  const [playing, setPlaying] = React.useState(false);
  const [tuning, setTuning] = React.useState(false);
  const [hud, setHud] = React.useState<HudState | null>(null);
  const reticleRef = React.useRef<HTMLDivElement | null>(null);
  const [showExport, setShowExport] = React.useState(false);
  const [showHelp, setShowHelp] = React.useState(false);
  const [exportJson, setExportJson] = React.useState('');
  const [exporting, setExporting] = React.useState(false);
  const [toasts, setToasts] = React.useState<ToastMsg[]>([]);
  const [typePanelId, setTypePanelId] = React.useState<string | null>(null);
  const [logicMode, setLogicMode] = React.useState(false);
  const [logLines, setLogLines] = React.useState<LogLine[]>([]);
  const [project, setProject] = React.useState('wasteland_base_01');
  const [assistantSnapshot, setAssistantSnapshot] = React.useState<string | null>(null);
  const [screenshotToolActive, setScreenshotToolActive] = React.useState(false);
  const [savedProjects, setSavedProjects] = React.useState<StoredProject[]>([]);
  const [autosave, setAutosave] = React.useState<boolean>(() => localStorage.getItem('wf_autosave') !== 'off');
  const [autosaveAt, setAutosaveAt] = React.useState<string>('');
  const [craftOptions, setCraftOptions] = React.useState<{ id: string; name: string; desc: string; ok: boolean; missing: string }[]>([]);
  // --- профайлер производительности ---
  const [perfOn, setPerfOn] = React.useState(false);
  const [perfInfo, setPerfInfo] = React.useState('');
  // --- конструктор меха ---
  const [mechSpec, setMechSpec] = React.useState<MechSpec>(defaultMechSpec);
  const [brush, setBrush] = React.useState<BrushSettings>({ radius: 0.5, strength: 0.5, falloff: 1.5 });
  const [brushMode, setBrushMode] = React.useState<BrushMode>('inflate');
  const [brushArmed, setBrushArmed] = React.useState(false);
  const [activePart, setActivePart] = React.useState<PartId | null>(null);

  const builderTarget = React.useMemo(
    () => (selectedId ? objects.find((o) => o.id === selectedId && o.assetId.startsWith('mech_')) ?? null : null),
    [selectedId, objects],
  );

  React.useEffect(() => {
    if (!builderTarget) return;
    const spec = engineRef.current?.mechSpecOf(builderTarget.id);
    if (spec) setMechSpec(spec);
  }, [builderTarget?.id]);

  const mechCommitTimer = React.useRef<number | null>(null);
  const applyMechSpec = (patch: Partial<MechSpec>) => {
    const next = { ...mechSpec, ...patch } as MechSpec;
    setMechSpec(next);
    if (!builderTarget) return;
    // notify=false: React-дерево не трогаем на каждом кадре — иначе слайдер дёргается
    eng().rebuildMech(builderTarget.id, next, false);
    if (mechCommitTimer.current) window.clearTimeout(mechCommitTimer.current);
    mechCommitTimer.current = window.setTimeout(() => {
      mechCommitTimer.current = null;
      eng().commitMechEdit();
    }, 220);
  };

  /** Кисть по клику в сцене: луч в мех и скальп по точке. */
  const applyBrushAtPointer = (clientX: number, clientY: number) => {
    const e = eng();
    if (!builderTarget) return;
    const hit = e.pickAt(clientX, clientY);
    if (!hit) { toast('Кисть: кликни прямо по меху', 'info'); return; }
    const n = e.sculptMech(hit.objectId, hit.point, brush, brushMode);
    if (n) toast(`Кисть: ${n} вершин`, 'ok');
  };

  // В режиме кисти клик по канвасу не выбирает объекты, а лепит форму
  React.useEffect(() => {
    if (!brushArmed) return;
    const dom = eng().renderer.domElement;
    const onDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      applyBrushAtPointer(ev.clientX, ev.clientY);
    };
    dom.addEventListener('pointerdown', onDown, true);
    return () => dom.removeEventListener('pointerdown', onDown, true);
  }, [brushArmed, builderTarget?.id, brushMode, brush.radius, brush.strength, brush.falloff]);
  const toastId = React.useRef(0);

  const refreshProjects = React.useCallback(async () => { setSavedProjects(await listProjects()); }, []);

  React.useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  React.useEffect(() => { localStorage.setItem('wf_autosave', autosave ? 'on' : 'off'); }, [autosave]);

  // Автосохранение раз в минуту — полный проект со звуками, в IndexedDB
  React.useEffect(() => {
    if (!autosave || !ready || !engineRef.current) return;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const json = await engineRef.current!.exportProjectJSON();
          if (await saveAutosave(json, project)) setAutosaveAt(new Date().toLocaleTimeString('ru-RU'));
        } catch { /* автосейв не должен мешать работе */ }
      })();
    }, 60000);
    return () => window.clearInterval(id);
  }, [autosave, ready, project]);

  const saveTimer = React.useRef<number | undefined>(undefined);
  const setLayout = React.useCallback((next: DockLayout) => {
    setLayoutState(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveLayout(next), 400);
  }, []);

  React.useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  const showPanel = React.useCallback((id: PanelId, zone: 'left' | 'right' | 'bottom' | 'center' = 'right') => {
    setLayoutState((prev) => {
      const next = setActive(setCollapsed(movePanel(prev, id, zone), zone, false), zone, id);
      saveLayout(next);
      return next;
    });
  }, []);

  const toast = React.useCallback((text: string, kind: ToastMsg['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  const log = React.useCallback((text: string, kind: LogLine['kind'] = 'info') => {
    setLogLines((l) => [...l.slice(-400), { t: new Date().toLocaleTimeString('ru-RU'), kind, text }]);
  }, []);

  const copyLog = React.useCallback(async () => {
    const text = [
      '=== Wasteland Forge · журнал раскладки панелей ===',
      `окно: ${window.innerWidth}x${window.innerHeight}, dpr: ${window.devicePixelRatio}`,
      `панелей в реестре: ${ALL_PANEL_IDS.length}`,
      ...logLines.map((l) => `[${l.t}] ${l.text}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Журнал скопирован — вставь мне', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Журнал скопирован', 'ok'); }
      catch { toast('Не удалось скопировать — выдели текст вручную', 'err'); }
      ta.remove();
    }
  }, [logLines, toast]);

  React.useEffect(() => {
    log('Редактор запущен. Интерфейс в стиле Construct 3: панели перетаскиваются между зонами.');
    void audio.restore().then((n) => {
      if (n > 0) {
        setEnv((prev) => ({ ...prev }));
        log(`Восстановлено звуков из библиотеки: ${n}`, 'ok');
      }
    });
  }, [log]);

  // ---- профайлер: включается сам, если сервер журнала доступен ----
  React.useEffect(() => {
    let cancelled = false;
    void perf.start().then((serverOk) => {
      if (cancelled) return;
      setPerfOn(true);
      setPerfInfo(serverOk
        ? `Профиль пишет: ${perf.logFile ?? 'лог на диске'}`
        : 'Сервер журнала недоступен — лог в памяти, кнопка «Скачать» сохранит файл');
      log(serverOk
        ? `Профайлер включён, журнал: ${perf.logFile}`
        : 'Профайлер включён (в памяти): сервер журнала не отвечает.', serverOk ? 'ok' : 'info');
    });
    return () => { cancelled = true; };
  }, [log]);

  const togglePerf = () => {
    if (perfOn) {
      perf.stop();
      setPerfOn(false);
      setPerfInfo('Профиль выключен');
      log('Профайлер выключен.', 'info');
    } else {
      void perf.start().then((serverOk) => {
        setPerfOn(true);
        setPerfInfo(serverOk ? `Профиль пишет: ${perf.logFile ?? ''}` : 'Лог в памяти');
        toast('Профайлер включён', 'ok');
      });
    }
  };

  // ---- engine lifecycle ----
  React.useEffect(() => {
    if (!viewportRef.current || engineRef.current) return;
    const engine = new EditorEngine(viewportRef.current, {
      onObjectsChange: (objs) => {
        setObjects(objs);
        setEnv({ ...engine.env });
      },
      onSelect: (id, ids) => {
        setSelectedId(id);
        setSelectedIds(ids);
        if (id) showPanel('inspector', 'right');
      },
      onStats: (s) => {
        setStats(s);
        // sync placement state (engine may cancel ghost internally)
        if (!engine.isPlacing() && placingRef.current) {
          placingRef.current = null;
          setPlacingId(null);
        }
      },
    });
    engineRef.current = engine;
    engine.init();
    engine.loadDemoScene();
    setReady(true);
    setEnv({ ...engine.env });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { placingRef.current = null; setPlacingId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, [showPanel]);

  const eng = () => engineRef.current!;

  // ---- actions ----
  const setPlacing = (id: string | null) => {
    if (!ready) return;
    if (id === null || id === placingId) {
      eng().cancelPlacement();
      placingRef.current = null;
      setPlacingId(null);
    } else {
      eng().startPlacement(id);
      placingRef.current = id;
      setPlacingId(id);
      log(`Режим размещения: ${id}`, 'info');
    }
  };

  const handleEnv = (patch: Partial<EnvState>) => {
    eng().setEnv(patch);
    setEnv({ ...eng().env });
  };

  const handleMode = (m: 'translate' | 'rotate' | 'scale') => {
    eng().setTransformMode(m);
    setMode(m);
  };

  const selected = objects.find((o) => o.id === selectedId) || null;

  // ---- роли объектов: одна система вместо двух ----
  /** Назначить роль объекту. Роль «Мех игрока» снимается с остальных мехов,
   *  роль «Точка спавна» включает режим появления по объекту. */
  const handleRole = (objectId: string, role: SceneObjectState['role']) => {
    const e = engineRef.current;
    if (!e) return;
    if (role === 'player') {
      objects.forEach((o) => {
        if (o.id !== objectId && o.role === 'player') e.updateObject(o.id, { role: 'prop' }, true);
      });
    }
    e.updateObject(objectId, { role }, true);
    if (role === 'spawn') {
      handleMechConfig({ spawnMode: 'spawn_object' });
      toast('Точка появления включена: игрок появится здесь', 'ok');
    }
    log(`Роль: ${role}`, 'info');
  };

  /** Выбор меха в панели «Мех» — синхронизируем с ролью объекта. */
  const handlePlayerObject = (id: string) => {
    handleMechConfig({ playerObjectId: id });
    const e = engineRef.current;
    if (!e) return;
    objects.forEach((o) => {
      if (!o.assetId.startsWith('mech_')) return;
      if (id === 'auto' || id === 'new') {
        if (o.role === 'player') e.updateObject(o.id, { role: 'prop' }, true);
      } else if (o.id === id) {
        if (o.role !== 'player') e.updateObject(o.id, { role: 'player' }, true);
      } else if (o.role === 'player') {
        e.updateObject(o.id, { role: 'reserve' }, true);
      }
    });
  };

  // ---- play mode ----
  const handleMechConfig = (patch: Partial<MechConfig>) => {
    setMechConfig((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem('wf_mech_config', JSON.stringify(next)); } catch { /* ignore */ }
      if (engineRef.current) engineRef.current.setMechConfig(next);
      return next;
    });
  };

  const stopPlay = React.useCallback(() => {
    const e = engineRef.current;
    if (!e || !e.isPlaying()) return;
    e.stopPlay();
    setPlaying(false);
    setTuning(false);
    setHud(null);
    setEnv({ ...e.env });
    log('Превью остановлено, сцена восстановлена.', 'info');
  }, [log]);

  const startPlay = (tune = false) => {
    if (!ready) return;
    if (eng().isPlaying()) { stopPlay(); return; }
    const previewConfig = tune ? { ...mechConfig, playerObjectId: 'new', defaultView: 'cockpit' as const } : mechConfig;
    const ok = eng().startPlay(previewConfig, scenario, {
      onHud: (h) => setHud(h),
      onPointer: (x, y, visible) => {
        const el = reticleRef.current;
        if (!el) return;
        el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = visible ? '1' : '0';
      },
      onExit: () => stopPlay(),
    }, tune);
    if (ok) {
      setPlaying(true); setTuning(tune); setHud(null);
      if (tune) showPanel('mech', 'right');
      setCraftOptions(eng().play?.craftOptions() ?? []);
      log(tune ? 'Настройка из кабины — бой на паузе.' : 'Запущено превью меха.', 'ok');
    } else toast('Не удалось запустить превью', 'err');
  };

  const restartPlay = () => {
    stopPlay();
    setHud(null);
    setTimeout(() => startPlay(), 30);
  };

  const handleScenario = (s: Scenario) => {
    setScenario(s);
    try { localStorage.setItem('wf_scenario', JSON.stringify(s)); } catch { /* ignore */ }
    if (engineRef.current) engineRef.current.setScenario(s);
  };

  const [worldVersion, setWorldVersion] = React.useState(0);
  const handleWorld = (patch: Parameters<EditorEngine['setWorld']>[0]) => {
    if (engineRef.current) engineRef.current.setWorld(patch);
    setWorldVersion((v) => v + 1);
  };

  const openExport = () => {
    setExportJson(eng().exportJSON());
    setShowExport(true);
  };

  const doDownloadJSON = async () => {
    try {
      const json = await eng().exportProjectJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      download(url, `${project}.wasteland.json`);
      setTimeout(() => URL.revokeObjectURL(url), 6000);
      const sounds = (JSON.parse(json).sounds ?? []).length;
      toast(sounds ? `Проект сохранён вместе со звуками (${sounds})` : 'Проект сохранён', 'ok');
      log(`Экспорт проекта: ${project}.wasteland.json, звуков внутри: ${sounds}`, 'ok');
    } catch {
      toast('Ошибка экспорта проекта', 'err');
    }
  };

  const doDownloadGLB = async (withGround: boolean) => {
    setExporting(true);
    try {
      const blob = await eng().exportGLB(withGround);
      const url = URL.createObjectURL(blob);
      download(url, `${project}.glb`);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      toast(`GLB экспортирован (${(blob.size / 1024).toFixed(0)} КБ)`, 'ok');
      log(`Экспорт GLB: ${project}.glb (${(blob.size / 1024).toFixed(0)} КБ)`, 'ok');
    } catch {
      toast('Ошибка экспорта GLB', 'err');
      log('Ошибка экспорта GLB', 'err');
    }
    setExporting(false);
  };

  const doScreenshot = (w: number) => {
    const url = eng().screenshot(w);
    download(url, `${project}_${w}px.png`);
    toast('Скриншот сохранён', 'ok');
  };

  const doExportObject = async (objectId: string, withAnimation: boolean) => {
    const o = objects.find((x) => x.id === objectId);
    if (!o) return;
    setExporting(true);
    try {
      const blob = await eng().exportObjectGLB(objectId, withAnimation);
      const url = URL.createObjectURL(blob);
      const safe = (o.name || o.assetId).replace(/[^\wа-яА-ЯёЁ_-]+/gi, '_').slice(0, 40);
      download(url, `${safe}${withAnimation ? '_anim' : ''}.glb`);
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      toast(`${o.name} выгружен в GLB${withAnimation ? ' с анимацией' : ''} · ${(blob.size / 1024).toFixed(0)} КБ`, 'ok');
      log(`Экспорт объекта «${o.name}»${withAnimation ? ' (с анимацией)' : ''}: ${(blob.size / 1024).toFixed(0)} КБ.`, 'ok');
    } catch (err) {
      toast('Не удалось выгрузить объект', 'err');
      log(`Ошибка экспорта объекта: ${err instanceof Error ? err.message : 'неизвестно'}`, 'err');
    }
    setExporting(false);
  };

  const doImportGlb = async (file: File) => {
    try {
      const name = file.name.replace(/\.glb$/i, "");
      const url = URL.createObjectURL(file);
      const id = eng().importGlbAsMech(name, url);
      if (id) {
        // сохраняем байты в localStorage — чтобы GLB переживал перезагрузку и новые вкладки
        const buf = await file.arrayBuffer();
        const stored = loadDynamicAssets().filter((a) => a.id !== id);
        stored.push({ id, name, base64: bytesToBase64(new Uint8Array(buf)) });
        saveDynamicAssets(stored);
        toast(`Мех «${name}» импортирован (сохранён в браузере)`, 'ok');
        log(`Импортирован GLB-мех «${name}» (сохранён для превью).`, 'ok');
      } else toast('Не удалось импортировать GLB', 'err');
    } catch (err) {
      toast('Ошибка импорта GLB', 'err');
      log(`Ошибка импорта GLB: ${err instanceof Error ? err.message : 'неизвестно'}`, 'err');
    }
  };

  /** Сохранить текущую сцену как уровень (JSON-файл для игры). */
  const saveLevelAsJson = async () => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const json = await e.exportProjectJSON();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      download(url, `level1.wasteland.json`);
      setTimeout(() => URL.revokeObjectURL(url), 6000);
      // также запоминаем в браузере — игра (game.html) подхватит этот уровень
      try { localStorage.setItem('wf_level_1_project', json); } catch { /* ignore */ }
      toast('Уровень сохранён как JSON и запомнен для игры', 'ok');
      log(`Уровень экспортирован (${(json.length / 1024 / 1024).toFixed(1)} МБ) и запомнен для игры.`, 'ok');
    } catch (err) {
      toast('Не удалось сохранить уровень', 'err');
      log(`Ошибка сохранения уровня: ${err instanceof Error ? err.message : 'неизвестно'}`, 'err');
    }
  };

  /** Загрузить уровень из JSON-файла в редактор. */
  const loadLevelFromJson = async (file: File) => {
    const e = engineRef.current;
    if (!e) return;
    try {
      const text = await file.text();
      const res = await e.importProjectJSON(text);
      if (res.ok) {
        setEnv({ ...e.env });
        setMechConfig({ ...e.mechConfig });
        setScenario(JSON.parse(JSON.stringify(e.scenario)) as Scenario);
        toast(`Уровень «${file.name}» загружен`, 'ok');
        log(`Уровень загружен: ${file.name}.`, 'ok');
      } else {
        toast(res.message ?? 'Не удалось загрузить уровень', 'err');
      }
    } catch (err) {
      toast('Ошибка загрузки уровня', 'err');
      log(`Ошибка загрузки уровня: ${err instanceof Error ? err.message : 'неизвестно'}`, 'err');
    }
  };

  const doImport = async (text: string) => {
    const res = await eng().importProjectJSON(text);
    if (res.ok) {
      setEnv({ ...eng().env });
      setMechConfig({ ...eng().mechConfig });
      setScenario(JSON.parse(JSON.stringify(eng().scenario)) as Scenario);
      setShowExport(false);
      toast(res.sounds ? `Проект загружен, звуков: ${res.sounds}` : 'Проект загружен', 'ok');
      log(`Импорт проекта выполнен, восстановлено звуков: ${res.sounds}`, 'ok');
    } else {
      toast(res.message ?? 'Некорректный проект', 'err');
      log(`Импорт не удался: ${res.message ?? 'ошибка'}`, 'err');
    }
  };

  const doNew = () => {
    if (objects.length > 0 && !window.confirm('Очистить сцену? Несохранённые изменения пропадут.')) return;
    eng().clearAll();
    toast('Новая сцена', 'info');
    log('Сцена очищена.', 'info');
  };

  // ================= СИСТЕМА СОХРАНЕНИЯ ПРОЕКТОВ (как в Construct 3) =================
  // Проекты живут в IndexedDB — там нет лимита 5 МБ, поэтому звуки и вся логика
  // сохраняются целиком и восстанавливаются одним кликом.
  const doSaveProject = async (name = project) => {
    try {
      const json = await eng().exportProjectJSON();
      const ok = await saveProject(name, name, json);
      if (!ok) { toast('Не удалось записать в хранилище браузера', 'err'); return; }
      await refreshProjects();
      const sounds = (JSON.parse(json).sounds ?? []).length;
      toast(`Проект «${name}» сохранён${sounds ? ` · звуков: ${sounds}` : ''}`, 'ok');
      log(`Проект «${name}» сохранён (${(json.length / 1024 / 1024).toFixed(1)} МБ).`, 'ok');
    } catch (err) {
      toast('Ошибка сохранения', 'err');
      log(`Ошибка сохранения: ${err instanceof Error ? err.message : 'неизвестно'}`, 'err');
    }
  };

  const loadProjectById = async (id: string) => {
    const rec = await loadProject(id);
    if (!rec) { toast('Проект не найден', 'err'); return; }
    const res = await eng().importProjectJSON(rec.json);
    if (res.ok) {
      setEnv({ ...eng().env });
      setMechConfig({ ...eng().mechConfig });
      setScenario(JSON.parse(JSON.stringify(eng().scenario)) as Scenario);
      setTypePanelId(null);
      toast(res.sounds ? `Загружено «${rec.name}» · звуков: ${res.sounds}` : `Загружено «${rec.name}»`, 'ok');
      log(`Проект «${rec.name}» загружен, звуков восстановлено: ${res.sounds}.`, 'ok');
    } else {
      toast(res.message ?? 'Не удалось загрузить проект', 'err');
    }
  };

  const removeProjectById = async (id: string) => {
    if (!confirm('Удалить сохранённый проект?')) return;
    await deleteProject(id);
    await refreshProjects();
    toast('Проект удалён', 'info');
  };

  const doRestoreAutosave = async () => {
    const rec = await loadAutosave();
    if (!rec) { toast('Автосохранение не найдено', 'err'); return; }
    const res = await eng().importProjectJSON(rec.json);
    if (res.ok) {
      setEnv({ ...eng().env });
      setMechConfig({ ...eng().mechConfig });
      setScenario(JSON.parse(JSON.stringify(eng().scenario)) as Scenario);
      toast(`Восстановлено автосохранение${res.sounds ? ` · звуков: ${res.sounds}` : ''}`, 'ok');
    } else toast('Автосохранение не восстановилось', 'err');
  };

  // Старые кнопки тулбара теперь работают через IndexedDB
  const doSaveLocal = () => doSaveProject(project);
  const doLoadLocal = () => loadProjectById(project);

  const setCamera = (preset: 'orbit' | 'top' | 'front' | 'cinema') => {
    const e = eng();
    if (preset === 'orbit') { e.camera.position.set(14, 11, 16); e.orbit.target.set(0, 1, 0); }
    if (preset === 'top') { e.camera.position.set(0.5, 42, 0.5); e.orbit.target.set(0, 0, 0); }
    if (preset === 'front') { e.camera.position.set(0, 3.2, 24); e.orbit.target.set(0, 2, 0); }
    if (preset === 'cinema') { e.camera.position.set(-9, 2.2, 13); e.orbit.target.set(2, 3.5, -4); }
  };

  const undo = () => { eng().undo(); setEnv({ ...eng().env }); log('Отмена действия.', 'info'); };
  const redo = () => { eng().redo(); setEnv({ ...eng().env }); log('Повтор действия.', 'info'); };

  // ---- panel content ----
  const renderPanel = (id: PanelId): React.ReactNode => {
    switch (id) {
      case 'hierarchy':
        return (
          <Hierarchy
            objects={objects} selectedId={selectedId} selectedIds={selectedIds}
            onSelect={(i, additive) => eng().select(i, additive)}
            onToggleVisible={(i) => { const o = objects.find((x) => x.id === i); if (o) eng().updateObject(i, { visible: !o.visible }, true); }}
            onToggleLock={(i) => { const o = objects.find((x) => x.id === i); if (o) eng().updateObject(i, { locked: !o.locked }, true); }}
            onDelete={(i) => eng().deleteObject(i)}
            onDuplicate={(i) => { eng().select(i); eng().duplicateSelected(); }}
            onFocus={(i) => { eng().select(i); eng().focusSelected(); }}
          />
        );
      case 'assets':
        return (
          <AssetPalette
            placingId={placingId}
            onPlace={(i) => setPlacing(i)}
            onSpawn={(i) => { eng().addAsset(i); showPanel('hierarchy', 'left'); toast('Объект добавлен', 'ok'); }}
          />
        );
      case 'inspector':
        return (
          <Inspector
            obj={selected}
            onUpdate={(i, patch, commit) => eng().updateObject(i, patch, commit)}
            onRole={(i, role) => handleRole(i, role)}
            selectedCount={selectedIds.length}
            onDuplicate={() => eng().duplicateSelected()}
            onDelete={() => eng().deleteSelected()}
            onFocus={() => eng().focusSelected()}
            onDrop={() => eng().dropToGround()}
            onExportObject={(id, anim) => void doExportObject(id, anim)}
            onImportGlb={(file) => void doImportGlb(file)}
            types={engineRef.current?.getTypes().map((t) => ({ id: t.id, name: t.name, role: t.role, category: t.category }))}
            onAssignType={(objectId, typeId) => {
              if (engineRef.current?.assignType(objectId, typeId)) log('Тип объекта изменён.', 'info');
            }}
          />
        );
      case 'environment':
        return <EnvironmentPanel env={env} onChange={handleEnv} />;
      case 'fx':
        return <EffectsPanel env={env} onChange={handleEnv} />;
      case 'types':
        return (
          <TypesPanel
            bridge={engineRef.current}
            selectedTypeId={typePanelId}
            onSelectType={setTypePanelId}
            toast={toast}
            selectedObject={selected ? { id: selected.id, name: selected.name, assetId: selected.assetId, typeId: selected.typeId } : null}
            onAssignType={(objectId, typeId) => {
              if (engineRef.current?.assignType(objectId, typeId)) {
                log(`Тип объекта изменён: ${typeId}`, 'info');
                toast('Тип назначен', 'ok');
              }
            }}
          />
        );
      case 'sheets':
        return <SheetsPanel bridge={engineRef.current} />;
      case 'project':
        return (
          <ProjectPanel
            bridge={engineRef.current ? {
              getTypes: () => engineRef.current!.getTypes(),
              getSheets: () => engineRef.current!.getSheets(),
              getGlobals: () => engineRef.current!.project.globals,
              getObjectCount: () => objects.length,
            } : null}
            selectedTypeId={typePanelId}
            selectedSheetId={null}
            onOpenTypes={() => showPanel('types', 'right')}
            onOpenSheet={(id) => { void id; showPanel('sheets', 'right'); }}
          />
        );
      case 'world': {
        const engine = engineRef.current;
        if (!engine) return <div className="p-3 text-[11px] text-stone-500">Движок запускается…</div>;
        return <WorldPanel key={worldVersion} world={engine.world} onWorld={handleWorld}
          onSaveLevel={() => saveLevelAsJson()}
          onLoadLevel={(file) => loadLevelFromJson(file)}
        />;
      }
      case 'sound':
        return <SoundPanel env={env} onChange={handleEnv} />;
      case 'scenario':
        return <ScenarioPanel scenario={scenario} onChange={handleScenario} />;
      case 'mech':
        return (
          <div>
            <div className="p-3">
              <Btn className="w-full" onClick={() => (tuning ? stopPlay() : startPlay(true))}>
                {tuning ? 'Завершить настройку кабины' : 'Настроить из кабины — живой вид'}
              </Btn>
              {tuning && <p className="mt-2 text-xs text-stone-400">Камера, шасси, цвет и рама обновляются сразу. Боевой сценарий приостановлен.</p>}
            </div>
            <MechPanel config={mechConfig} onChange={handleMechConfig} objects={objects} onPlay={() => startPlay()} playing={playing} onPlayerObject={handlePlayerObject} selectedId={selectedId} onRole={handleRole} />
          </div>
        );
      case 'minimap':
        return (
          <div className="p-2">
            <Minimap
              objects={objects}
              selectedId={selectedId}
              onSelect={(i) => eng().select(i)}
              center={hud
                ? { x: hud.pos[0], z: hud.pos[1], yaw: hud.yaw, isPlayer: true }
                : selected
                  ? { x: selected.position[0], z: selected.position[2], yaw: (selected.rotation[1] * Math.PI) / 180 }
                  : null}
            />
          </div>
        );
      case 'console':
        return <ConsolePanel lines={logLines} onCopy={copyLog} onClear={() => setLogLines([])} />;
      case 'mechbuilder':
        return (
          <MechBuilderPanel
            objectId={builderTarget?.id ?? null}
            objectName={builderTarget?.name ?? ''}
            assetId={builderTarget?.assetId ?? undefined}
            spec={mechSpec}
            onChange={applyMechSpec}
            brush={brush}
            onBrushChange={(p) => setBrush((b) => ({ ...b, ...p }))}
            brushMode={brushMode}
            onBrushMode={setBrushMode}
            onApplyBrush={() => { setBrushArmed(true); showPanel('mechbuilder', 'right'); toast('Кисть вооружена — кликай по меху в сцене', 'info'); }}
            onResetSculpt={() => {
              if (!builderTarget) return;
              if (eng().resetMechSculpt(builderTarget.id)) toast('Скульптинг сброшен', 'ok');
            }}
            onSaveVariant={() => {
              if (!builderTarget) return;
              const spec = eng().mechSpecOf(builderTarget.id);
              if (!spec) return;
              const id = eng().addAsset(builderTarget.assetId);
              if (id) {
                eng().rebuildMech(id, spec);
                toast('Вариант меха создан — он в иерархии', 'ok');
              }
            }}
            onApplyToAll={() => {
              const mechs = objects.filter((o) => o.assetId.startsWith('mech_'));
              for (const m of mechs) eng().rebuildMech(m.id, mechSpec);
              toast(`Пропорции применены к ${mechs.length} мехам`, 'ok');
            }}
            onApplyPreset={(preset) => {
              if (!builderTarget) return;
              eng().applyMechPartPreset(builderTarget.id, preset);
              toast(`Пресет: ${preset.label}`, 'ok');
            }}
            activePart={activePart}
            onSelectPart={(p) => {
              setActivePart(p);
              if (p === null) eng().deselectMechPart();
              else if (builderTarget) eng().selectMechPart(builderTarget.id, p);
            }}
            onDeselectPart={() => {
              setActivePart(null);
              eng().deselectMechPart();
            }}
              onTransformMode={(m) => {
                eng().setTransformMode(m);
              }}
          />
        );
      case 'animations':
        return <AnimationsPanel bridge={engineRef.current} selectedId={selectedId} selectedAssetId={selected?.assetId} selectedName={selected?.name} selectedRole={selected?.role} selectedAnim={selected?.anim} />;
      case 'assistant':
        return <AssistantPanel attachedSnapshot={assistantSnapshot} onClearSnapshot={() => setAssistantSnapshot(null)} />;
      case 'saves':
        return (
          <SavesPanel
            currentName={project}
            onRename={setProject}
            saved={savedProjects}
            autosave={autosave}
            autosaveAt={autosaveAt}
            onAutosaveChange={setAutosave}
            onSave={() => void doSaveProject(project)}
            onLoad={(id) => void loadProjectById(id)}
            onDelete={(id) => void removeProjectById(id)}
            onRestoreAutosave={() => void doRestoreAutosave()}
            onSaveFile={doDownloadJSON}
            onLoadFile={doImport}
          />
        );
      default:
        return null;
    }
  };

  const menus: MenuDef[] = [
    {
      label: 'Файл',
      items: [
        { label: 'Новая сцена', onClick: doNew },
        { separator: true },
        { label: 'Сохранить проект (со звуками)', onClick: doSaveLocal },
        { label: 'Загрузить проект', onClick: doLoadLocal },
        { label: 'Панель «Сохранения»', onClick: () => showPanel('saves', 'right') },
        { separator: true },
        { label: 'Восстановить автосохранение', onClick: () => void doRestoreAutosave() },
        { separator: true },
        { label: 'Экспорт / Импорт…', onClick: openExport },
        { label: 'Скриншот PNG', onClick: () => doScreenshot(1920) },
      ],
    },
    {
      label: 'Правка',
      items: [
        { label: 'Дублировать', shortcut: 'Ctrl+D', disabled: !selectedId || playing, onClick: () => eng().duplicateSelected() },
        { label: 'Удалить', shortcut: 'Del', danger: true, disabled: !selectedId || playing, onClick: () => eng().deleteSelected() },
        { separator: true },
        { label: 'Отменить', shortcut: 'Ctrl+Z', onClick: undo },
        { label: 'Повторить', shortcut: 'Ctrl+Y', onClick: redo },
        { separator: true },
        { label: 'Фокус на объекте', shortcut: 'F', disabled: !selectedId || playing, onClick: () => eng().focusSelected() },
        { label: 'Опустить на землю', shortcut: 'G', disabled: !selectedId || playing, onClick: () => eng().dropToGround() },
      ],
    },
    {
      label: 'Вид',
      items: [
        { label: 'Камера: орбита', onClick: () => setCamera('orbit') },
        { label: 'Камера: сверху', onClick: () => setCamera('top') },
        { label: 'Камера: фронт', onClick: () => setCamera('front') },
        { label: 'Камера: кино', onClick: () => setCamera('cinema') },
        { separator: true },
        { label: `Сетка ${env.grid ? '✓' : ''}`, onClick: () => handleEnv({ grid: !env.grid }) },
        { label: `Привязка к сетке ${env.snap ? '✓' : ''}`, onClick: () => handleEnv({ snap: !env.snap }) },
        { label: `Границы коллизий ${env.showCollisions ? '✓' : ''}`, onClick: () => handleEnv({ showCollisions: !env.showCollisions }) },
        { separator: true },
        {
          label: 'Пыль в воздухе',
          onClick: () => handleEnv({ fx: { ...env.fx, dust: !(env.fx?.dust ?? true) } }),
        },
        {
          label: 'Туман',
          onClick: () => handleEnv({ fx: { ...env.fx, fog: !(env.fx?.fog ?? true) } }),
        },
        {
          label: 'Тени',
          onClick: () => handleEnv({ fx: { ...env.fx, shadows: !(env.fx?.shadows ?? true) } }),
        },
        { label: 'Панель «Эффекты»', onClick: () => showPanel('fx', 'right') },
        { separator: true },
        {
          label: 'Сбросить раскладку панелей',
          onClick: () => { setLayout(resetLayout()); toast('Раскладка панелей сброшена', 'ok'); log('Раскладка панелей сброшена к стандарту.', 'info'); },
        },
      ],
    },
    {
      label: 'Панели',
      items: [
        ...ALL_PANEL_IDS.map((id) => ({
          label: `${PANELS[id].title}${PANELS[id].origin === 'ours' ? '  — наша' : ''}`,
          onClick: () => showPanel(id, 'right'),
        })),
        { separator: true },
        { label: 'Демо-сцена', onClick: () => { eng().loadDemoScene(); toast('Демо-сцена загружена', 'ok'); log('Загружена демо-сцена.', 'ok'); } },
      ],
    },
    {
      label: 'Объект',
      items: [
        { label: 'Свойства объекта', disabled: !selectedId, onClick: () => showPanel('inspector', 'right') },
        { label: 'Структура проекта', onClick: () => showPanel('hierarchy', 'left') },
        { label: 'Библиотека моделей', onClick: () => showPanel('assets', 'left') },
        { separator: true },
        { label: 'Выгрузить объект в .glb', disabled: !selectedId, onClick: () => selectedId && void doExportObject(selectedId, false) },
        { label: 'Выгрузить объект с анимацией', disabled: !selectedId, onClick: () => selectedId && void doExportObject(selectedId, true) },
      ],
    },
    {
      label: 'Справка',
      items: [
        { label: 'Горячие клавиши и легенда', shortcut: 'F1', onClick: () => setShowHelp(true) },
      ],
    },
  ];

  const hiddenZones: ZoneId[] = playing && !tuning ? ['left', 'right', 'bottom'] : tuning ? ['left', 'bottom'] : [];
  const hiddenPanels: PanelId[] = playing && !tuning
    ? [...ALL_PANEL_IDS]
    : tuning
      ? ALL_PANEL_IDS.filter((id) => id !== 'mech')
      : [];

  // ================= RENDER =================
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0c0a08] text-stone-200">
      <MenuBar
        brand={
          <div className="flex items-center gap-2 pr-3">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-500/40 bg-gradient-to-br from-amber-600/30 to-red-900/30">
              <Radiation size={15} className="text-amber-400" />
            </div>
            <div className="leading-none">
              <div className="text-[12px] font-black tracking-[0.12em] text-amber-100">
                WASTELAND <span className="text-amber-500">FORGE</span>
              </div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.2em] text-stone-500">рабочая среда</div>
            </div>
          </div>
        }
        menus={menus}
      >
        <div className="ml-auto flex items-center gap-2">
          <OursMark />
          <span className="text-[9px] uppercase tracking-wider text-stone-600">наша функция — нет в Construct 3</span>
        </div>
      </MenuBar>

      <div className="flex h-[46px] shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#100d0a] px-3">
        <input
          value={project} onChange={(e) => setProject(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
          title="Имя проекта (для файлов экспорта)"
          className="w-36 rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-300 focus:border-amber-500/50 focus:outline-none"
        />

        <div className="mx-1 h-7 w-px bg-white/10" />

        <div className="flex items-center gap-1">
          <IconBtn title="Перемещение (W)" active={mode === 'translate'} onClick={() => handleMode('translate')}><Move size={15} /></IconBtn>
          <IconBtn title="Вращение (E)" active={mode === 'rotate'} onClick={() => handleMode('rotate')}><RotateCw size={15} /></IconBtn>
          <IconBtn title="Масштаб (R)" active={mode === 'scale'} onClick={() => handleMode('scale')}><Scaling size={15} /></IconBtn>
        </div>
        <div className="mx-1 h-7 w-px bg-white/10" />
        <div className="flex items-center gap-1">
          <IconBtn title="Привязка к сетке" active={env.snap} onClick={() => handleEnv({ snap: !env.snap })}><Magnet size={15} /></IconBtn>
          <IconBtn title="Показать сетку" active={env.grid} onClick={() => handleEnv({ grid: !env.grid })}><LayoutGrid size={15} /></IconBtn>
          <IconBtn title="Показать границы коллизий" active={!!env.showCollisions} onClick={() => handleEnv({ showCollisions: !env.showCollisions })}><BoxSelect size={15} /></IconBtn>
          <IconBtn title="Отмена (Ctrl+Z)" onClick={undo}><Undo2 size={15} /></IconBtn>
          <IconBtn title="Повтор (Ctrl+Y)" onClick={redo}><Redo2 size={15} /></IconBtn>
        </div>
        <div className="mx-1 hidden h-7 w-px bg-white/10 md:block" />
        <div className="hidden items-center gap-1 md:flex">
          <IconBtn title="Дублировать (Ctrl+D)" disabled={!selectedId || playing} onClick={() => eng().duplicateSelected()}><Copy size={15} /></IconBtn>
          <IconBtn title="Фокус (F)" disabled={!selectedId || playing} onClick={() => eng().focusSelected()}><Focus size={15} /></IconBtn>
          <IconBtn title="На землю (G)" disabled={!selectedId || playing} onClick={() => eng().dropToGround()}><ArrowDownToLine size={15} /></IconBtn>
          <IconBtn title="Удалить (Del)" danger disabled={!selectedId || playing} onClick={() => eng().deleteSelected()}><Trash2 size={15} /></IconBtn>
        </div>

        <div className="mx-2 flex items-center gap-1">
          <button
            onClick={() => startPlay()}
            title={playing ? 'Остановить превью (Esc)' : 'Запустить превью — сесть в кабину меха'}
            className={cn(
              'flex h-9 items-center gap-2 rounded-md border px-4 text-[12px] font-black uppercase tracking-[0.15em] transition-all',
              playing
                ? 'border-red-500/70 bg-red-600/25 text-red-200 shadow-[0_0_18px_rgba(255,60,60,0.35)] hover:bg-red-600/40'
                : 'border-emerald-500/60 bg-emerald-600/20 text-emerald-200 shadow-[0_0_18px_rgba(60,255,140,0.2)] hover:bg-emerald-600/35',
            )}
          >
            {playing ? <><Square size={13} fill="currentColor" /> Стоп</> : <><Play size={13} fill="currentColor" /> Превью</>}
          </button>
          {!playing && (
            <IconBtn title="Настройки кабины и управления" onClick={() => showPanel('mech', 'right')}>
              <Gamepad2 size={15} />
            </IconBtn>
          )}
          <button
            onClick={() => setLogicMode((v) => !v)}
            title="Вкладка логики — вся ширина под события и действия"
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-md border px-3 text-[11px] font-bold uppercase tracking-wider transition-all',
              logicMode
                ? 'border-emerald-500/70 bg-emerald-600/20 text-emerald-200 shadow-[0_0_16px_rgba(60,255,140,0.2)]'
                : 'border-white/10 bg-white/[0.04] text-stone-400 hover:border-emerald-500/50 hover:text-emerald-300',
            )}
          >
            <ListTree size={14} /> Логика
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <IconBtn
            title={perfOn ? `Профиль ВКЛ — ${perfInfo}. Нажми, чтобы выключить` : 'Профиль производительности: писать кадры в лог на диск'}
            active={perfOn}
            onClick={togglePerf}
          >
            <Gauge size={13} />
          </IconBtn>
          {perfOn && (
            <Btn title="Скачать лог профиля в файл (если сервер журнала недоступен)" onClick={() => perf.download()}>
              <Download size={13} /> Лог
            </Btn>
          )}
          <Btn title="Новая сцена" onClick={doNew}><Plus size={13} /></Btn>
          <Btn title="Сохранить проект целиком (сцена, логика, звуки)" onClick={doSaveLocal}><Save size={13} /></Btn>
          <Btn title="Загрузить сохранённый проект" onClick={doLoadLocal}><FolderOpen size={13} /></Btn>
          <Btn title="Скриншот PNG" onClick={() => doScreenshot(1920)}><Camera size={13} /></Btn>
          <IconBtn title="Скриншот для помощника (выделение области)" active={screenshotToolActive} onClick={() => setScreenshotToolActive((v) => !v)}>
            <Pencil size={13} />
          </IconBtn>
          <IconBtn title="Конструктор меха: выбери мех — размеры, части и скульптинг" onClick={() => showPanel('mechbuilder', 'right')}>
            <Hammer size={13} />
          </IconBtn>
          <Btn title="Экспорт / Импорт (JSON, GLB, PNG)" variant="primary" onClick={openExport}>
            <Download size={13} /> Экспорт
          </Btn>
          <IconBtn title="Справка, горячие клавиши и легенда панелей" onClick={() => setShowHelp(true)}><HelpCircle size={15} /></IconBtn>
        </div>
      </div>

      <Workspace
        layout={layout}
        onChange={setLayout}
        renderPanel={renderPanel}
        hiddenPanels={hiddenPanels}
        hiddenZones={hiddenZones}
        onEvent={(line) => log(line)}
        viewport={
          <main className="relative h-full w-full bg-black">
            {/* Сцена всегда смонтирована: если размонтировать div с канвасом,
                WebGL-канвас отсоединяется от DOM и после возврата сцена чёрная. */}
            <div className={cn('absolute inset-0', logicMode && !playing && 'invisible pointer-events-none')}>
            <div ref={viewportRef} className="absolute inset-0" />
            {!playing && (
              <ScreenshotTool
                canvasRef={viewportRef}
                isActive={screenshotToolActive}
                onCapture={(dataUrl: string) => {
                  setAssistantSnapshot(dataUrl);
                  setScreenshotToolActive(false);
                  showPanel('assistant', 'right');
                }}
                onCancel={() => setScreenshotToolActive(false)}
              />
            )}
            {!ready && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0c0a08]">
                <Radiation size={40} className="animate-spin text-amber-500 [animation-duration:3s]" />
                <div className="text-[13px] font-bold tracking-widest text-stone-400">ЗАГРУЗКА ПУСТОШИ…</div>
              </div>
            )}

            {playing && !tuning && (
              <PlayHUD
                hud={hud} config={mechConfig} objects={objects} reticleRef={reticleRef}
                onExit={stopPlay} onRestart={restartPlay}
                onView={(v) => eng().play?.setView(v)}
                onVision={(v) => eng().play?.setVision(v)}
                onEject={() => eng().ejectMech()}
                onEnterMech={(id) => {
                  const p = eng().play;
                  if (!p) return;
                  if (id === '__own__') p.reenterOwnMech();
                  else p.enterMech(id);
                }}
                mechs={objects.filter((o) => o.assetId.startsWith('mech_') && o.visible).map((o) => ({
                  id: o.id, name: o.name || o.assetId, assetId: o.assetId
                }))}
                onCraft={(recipeId) => { eng().play?.craftMech(recipeId); setCraftOptions(eng().play?.craftOptions() ?? []); }}
                onUseMedkit={() => eng().play?.useMedkit()}
                onRefreshCraft={() => setCraftOptions(eng().play?.craftOptions() ?? [])}
                craftOptions={craftOptions}
              />
            )}
            {tuning && <>
              <div className="pointer-events-none absolute inset-0"><CockpitFrame opacity={mechConfig.cockpit.frameOpacity} scanlines={mechConfig.cockpit.scanlines} color={mechConfig.hudColor} /></div>
              <button className="absolute left-3 top-3 rounded bg-black/80 px-3 py-2 text-xs text-amber-300" onClick={stopPlay}>Закрыть настройку кабины · Esc</button>
              <div className="pointer-events-none absolute left-1/2 top-1/2 text-2xl" style={{ color: mechConfig.hudColor }}>+</div>
            </>}

            {!playing && (
              <div className="absolute left-3 top-3 flex gap-1">
                {([['orbit', 'Орбита'], ['top', 'Сверху'], ['front', 'Фронт'], ['cinema', 'Кино']] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setCamera(id)}
                    className="rounded-md border border-white/10 bg-black/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 backdrop-blur-sm transition-all hover:border-amber-500/50 hover:text-amber-300">
                    {label}
                  </button>
                ))}
              </div>
            )}

            {placingId && !playing && (
              <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-emerald-500/50 bg-black/75 px-4 py-2 text-[12px] font-bold text-emerald-300 backdrop-blur-md">
                <MousePointer2 size={14} />
                Клик по земле — разместить · Shift — серия · Esc — отмена
                <button onClick={() => setPlacing(null)} className="ml-1 rounded bg-white/10 p-0.5 hover:bg-white/20"><X size={12} /></button>
              </div>
            )}

            {!playing && (
              <div className="absolute bottom-3 left-3 hidden rounded-md border border-white/10 bg-black/60 px-2.5 py-1.5 text-[10px] text-stone-500 backdrop-blur-sm md:block">
                <b className="text-stone-300">ЛКМ-клик</b> выбор · <b className="text-stone-300">Ctrl+ЛКМ</b> добавить · <b className="text-stone-300">Ctrl+рамка</b> выделить много · <b className="text-stone-300">ЛКМ-drag</b> орбита · <b className="text-stone-300">колесо</b> зум
              </div>
            )}

            {selected && !playing && (
              <div className="absolute bottom-3 left-1/2 hidden -translate-x-1/2 items-center gap-2 rounded-lg border border-amber-500/40 bg-black/75 px-3 py-1.5 backdrop-blur-md lg:flex">
                {selectedIds.length > 1 && (
                  <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-200">
                    {selectedIds.length} объектов
                  </span>
                )}
                <span className="max-w-[220px] truncate text-[11px] font-bold text-amber-200">{selected.name}</span>
                <span className="font-mono text-[10px] text-stone-500">
                  [{selected.position ? selected.position.map((v) => (v ?? 0).toFixed(1)).join(', ') : '—'}] · Y:{selected.rotation ? Math.round(selected.rotation[1] ?? 0) : '—'}°
                </span>
                <button onClick={() => eng().focusSelected()} title="Фокус" className="rounded p-1 text-stone-400 hover:text-amber-300"><Video size={12} /></button>
              </div>
            )}
            </div>

            {/* Вкладка «Логика» — накладка поверх сцены, сцена остаётся живой */}
            {logicMode && !playing && (
              <div className="absolute inset-0 z-20 overflow-hidden bg-[#0e0c09]">
                <SheetsPanel bridge={engineRef.current} wide />
              </div>
            )}
          </main>
        }
      />

      <StatusBar
        stats={stats} selected={selected}
        hint={playing
          ? 'ПРЕВЬЮ: WASD ход · СКМ зажать — камера · ЛКМ огонь · ПКМ залп · 1-4 оружие · V вид · N зрение · Space джеты · Esc выход'
          : 'W/E/R гизмо · F фокус · G на землю · Ctrl+D дубль · Del удалить · Shift+клик серия · ▶ Превью — тест меха'}
      />

      {showExport && (
        <Modal title="Экспорт / Импорт сцены" wide onClose={() => setShowExport(false)}>
          <ExportModal
            json={exportJson}
            onClose={() => setShowExport(false)}
            onDownloadJSON={doDownloadJSON}
            onDownloadGLB={doDownloadGLB}
            onScreenshot={doScreenshot}
            onImportJSON={doImport}
            exporting={exporting}
          />
        </Modal>
      )}

      {showHelp && (
        <Modal title="Справка — Wasteland Forge" wide onClose={() => setShowHelp(false)}>
          <div className="space-y-4 p-4 text-[12px] leading-relaxed text-stone-400">
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Легенда панелей</h3>
              <p className="mb-2">Панели без метки повторяют возможности Construct 3. Панели с зелёной меткой <OursMark className="align-middle" /> — наши авторские функции, которых в Construct 3 нет.</p>
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_PANEL_IDS.map((id) => (
                  <div key={id} className="flex items-center gap-2 rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
                    {PANELS[id].origin === 'ours' ? <OursMark /> : <span className="inline-flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-[3px] border border-white/15 font-mono text-[8px] text-stone-600">C3</span>}
                    <span className="shrink-0 text-[11px] font-bold text-stone-200">{PANELS[id].title}</span>
                    <span className="truncate text-[10px] text-stone-500">{PANELS[id].c3Note}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Рабочая среда</h3>
              <p>Слева — «Структура» и «Библиотека», по центру — сцена, справа — «Свойства» и настройки, снизу — «Консоль» и «Мини-карта», как в Construct 3.
                Вкладку панели можно <b className="text-stone-200">перетащить</b> в другую зону или за пределы — панель отсоединится в отдельное плавающее окно, которое перетаскивается за заголовок, ресайзится за угол и прикрепляется обратно кнопками в шапке.
                Границы зон тянутся мышью. Раскладка сохраняется автоматически; сбросить её можно через меню <b className="text-stone-200">Вид → Сбросить раскладку панелей</b>.</p>
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Рабочий процесс</h3>
              <p>1. Выберите модель в панели <b className="text-stone-200">Библиотека</b> и нажмите «Поставить», затем кликните по земле в сцене (Shift — ставить серию).
                2. Редактируйте гизмо (W/E/R) или числами в панели <b className="text-stone-200">Свойства</b>: позиция, вращение, масштаб, ржавчина, оттенок.
                3. Настройте атмосферу в <b className="text-stone-200">Окружение</b>. 4. Экспортируйте в <b className="text-stone-200">JSON</b> или <b className="text-stone-200">GLB</b>.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['W / E / R', 'Гизмо: движение / вращение / масштаб'],
                ['F', 'Фокус камеры на объекте'],
                ['G', 'Опустить объект на землю'],
                ['Del', 'Удалить выбранное'],
                ['Ctrl+D', 'Дублировать'],
                ['Ctrl+Z / Ctrl+Y', 'Отмена / повтор'],
                ['ЛКМ-клик / drag', 'Выбор / орбита камеры'],
                ['ПКМ-drag / колесо', 'Панорама / зум'],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
                  <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">{k}</span>
                  <span className="text-[11px]">{v}</span>
                </div>
              ))}
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Форматы экспорта</h3>
              <ul className="list-disc space-y-1 pl-5">
                <li><b className="text-stone-200">JSON</b> — лёгкое описание сцены (assetId + трансформ + материалы). Идеально для загрузки в собственный движок игры и версионирования в git.</li>
                <li><b className="text-stone-200">GLB (glTF 2.0)</b> — запечённая геометрия со всеми PBR-материалами. Открывается в Blender / Unity / Unreal / Godot без конвертации.</li>
                <li><b className="text-stone-200">PNG</b> — скриншот до 2560px для референсов и питчей.</li>
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Превью (Play-режим)</h3>
              <p>Кнопка <b className="text-emerald-300">▶ Превью</b> запускает сцену как игру: вы управляете мехом (WASD, Shift — форсаж, Space — джеты),
                стреляете (ЛКМ — выбранное оружие, ПКМ — залп, 1–4/Tab — смена), камера вращается на <b className="text-stone-200">зажатом колёсике</b>,
                колесо — зум. V переключает виды: кабина / третье лицо / плечо / тактический; N — ночное видение и тепловизор.
                Объекты сцены разрушаемы (бочки детонируют по цепочке). При выходе сцена восстанавливается. Всё настраивается в панели <b className="text-stone-200">Мех</b>.</p>
            </div>
            <div>
              <h3 className="mb-1 text-[11px] font-bold uppercase tracking-widest text-amber-400">Модели</h3>
              <p>Все 26 моделей — процедурные, с PBR-текстурами ржавчины, бетона и брони, сгенерированными в редакторе.
                Слайдер «Ржавчина» в свойствах меняет коррозию каждого объекта индивидуально. Мехи — «Ястреб» (разведчик), «Титан» (джаггернаут), «Молот» (штурмовик).</p>
            </div>
          </div>
        </Modal>
      )}

      <Toasts items={toasts} />
    </div>
  );
}