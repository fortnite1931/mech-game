import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { EditorEngine } from "../three/EditorEngine";
import type { SceneObjectState } from "../three/EditorEngine";
import type { HudState, MechConfig, ViewMode, VisionMode } from "../three/playTypes";
import { PlayHUD } from "../components/hud.tsx";

/**
 * Игровой клиент (публикуется на платформах: Яндекс Игры, VK Play и т.п.).
 * В отличие от редактора — без панелей: полноэкранный рендер + меню + HUD.
 * Здесь будут расти: стартовое меню, уровни, катсцены, сохранения, SDK.
 */

/** Временная админка (баланс). Убрать перед релизом на платформы. */
type AdminVals = {
  mechSpeed: number;
  pilotWalk: number;
  pilotRun: number;
  dmgFromPlayer: number;
  dmgToPlayer: number;
  enemyHpMul: number;
  enemyDmgMul: number;
};
const ADMIN_DEFAULTS: AdminVals = {
  mechSpeed: 1, pilotWalk: 1, pilotRun: 1,
  dmgFromPlayer: 1, dmgToPlayer: 1,
  enemyHpMul: 1, enemyDmgMul: 1,
};

/** Настройки админки автосохраняются в браузере (переживают перезагрузку). */
const ADMIN_STORAGE_KEY = "wf_admin_balance";
function loadAdmin(): AdminVals {
  try {
    const raw = localStorage.getItem(ADMIN_STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AdminVals>;
      return { ...ADMIN_DEFAULTS, ...v };
    }
  } catch { /* ignore */ }
  return ADMIN_DEFAULTS;
}
function Game() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [objects, setObjects] = useState<SceneObjectState[]>([]);
  const [cfg, setCfg] = useState<MechConfig | null>(null);
  const [admin, setAdmin] = useState<AdminVals>(loadAdmin);
  const [adminOpen, setAdminOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // автосохранение админки при изменении
  useEffect(() => {
    try { localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(admin)); } catch { /* ignore */ }
  }, [admin]);

  /** Импорт настроек из JSON-файла */
  const importAdminJson = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const v = JSON.parse(String(reader.result)) as Partial<AdminVals>;
        const next = { ...ADMIN_DEFAULTS, ...v };
        setAdmin(next);
        const play = engineRef.current?.play;
        if (play) {
          play.setBalance({
            mechSpeed: next.mechSpeed, pilotWalk: next.pilotWalk, pilotRun: next.pilotRun,
            dmgFromPlayer: next.dmgFromPlayer, dmgToPlayer: next.dmgToPlayer,
          });
          play.setEnemyMults(next.enemyHpMul, next.enemyDmgMul);
        }
      } catch { /* ignore */ }
    };
    reader.readAsText(file);
  };

  /** Применить настройку админки сразу в игру. */
  const applyAdmin = (patch: Partial<AdminVals>) => {
    const next = { ...admin, ...patch };
    setAdmin(next);
    const play = engineRef.current?.play;
    if (!play) return;
    play.setBalance({
      mechSpeed: next.mechSpeed,
      pilotWalk: next.pilotWalk,
      pilotRun: next.pilotRun,
      dmgFromPlayer: next.dmgFromPlayer,
      dmgToPlayer: next.dmgToPlayer,
    });
    play.setEnemyMults(next.enemyHpMul, next.enemyDmgMul);
  };

  // движок создаётся один раз на весь сеанс игры
  useEffect(() => {
    if (!hostRef.current || engineRef.current) return;
    const engine = new EditorEngine(hostRef.current, {
      onObjectsChange: (objs) => setObjects(objs),
      onSelect: () => {},
      onStats: () => {},
    });
    engineRef.current = engine;
    engine.init();
    engine.loadDemoScene();
    // M — открыть/закрыть админку прямо поверх игры (без рестарта)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM") {
        e.preventDefault();
        setAdminOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const startGame = () => {
    const e = engineRef.current;
    if (!e) return;
    if (e.isPlaying()) e.stopPlay();
    const ok = e.startPlay(e.mechConfig, e.scenario, {
      onHud: (h) => setHud(h),
      onPointer: (x, y, visible) => {
        const el = reticleRef.current;
        if (!el) return;
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.opacity = visible ? "1" : "0";
      },
      onExit: () => setPlaying(false),
    });
    if (ok) {
      setPlaying(true);
      setHud(null);
      setCfg({ ...e.mechConfig });
      // применяем сохранённые настройки админки к новой игре
      const play = e.play;
      if (play) {
        play.setBalance({
          mechSpeed: admin.mechSpeed,
          pilotWalk: admin.pilotWalk,
          pilotRun: admin.pilotRun,
          dmgFromPlayer: admin.dmgFromPlayer,
          dmgToPlayer: admin.dmgToPlayer,
        });
        play.setEnemyMults(admin.enemyHpMul, admin.enemyDmgMul);
      }
    }
  };

  const toMenu = () => {
    engineRef.current?.stopPlay();
    setPlaying(false);
    setHud(null);
  };

  const restartGame = () => {
    const e = engineRef.current;
    if (!e) return;
    e.stopPlay();
    setTimeout(() => startGame(), 30);
  };

  const viewOf = (v: ViewMode) => engineRef.current?.play?.setView(v);
  const visionOf = (v: VisionMode) => engineRef.current?.play?.setVision(v);
  const mechs = objects
    .filter((o) => o.visible && o.assetId.startsWith("mech_"))
    .map((o) => ({ id: o.id, name: o.name, assetId: o.assetId }));

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black text-stone-200">
      {/* сцена игры */}
      <div ref={hostRef} className="absolute inset-0" />

      {/* стартовое меню */}
      {!playing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-black/80 via-black/60 to-black/90">
          <div className="w-full max-w-md px-6 text-center">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.35em] text-amber-500/70">
              меха · пустоши · контракт
            </div>
            <h1 className="mb-3 text-4xl font-black tracking-tight text-amber-400 drop-shadow-[0_0_28px_rgba(245,166,35,0.35)]">
              Wasteland
              <span className="block text-2xl text-stone-100">Forge</span>
            </h1>
            <p className="mb-6 text-[13px] leading-relaxed text-stone-400">
              Садись в мех, выполняй контракты и выживай в пустошах.
              Противник — техника с ИИ: мехи, турели, дроны.
            </p>
            <button
              onClick={startGame}
              className="mb-3 block w-full rounded border border-amber-500/50 bg-amber-500/15 px-4 py-3 text-sm font-black uppercase tracking-widest text-amber-300 transition-all hover:bg-amber-500/25"
            >
              ▶ Играть
            </button>
            <button
              onClick={() => setShowHelp((v) => !v)}
              className="block w-full rounded border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-300 transition-all hover:border-white/25"
            >
              Как играть
            </button>
            <button
              onClick={() => setAdminOpen(true)}
              className="mt-2 block w-full rounded border border-stone-500/30 bg-stone-500/10 px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-stone-400 transition-all hover:border-amber-500/40 hover:text-amber-300"
            >
              ⚙ Админка (баланс)
            </button>
            {showHelp && (
              <div className="mt-4 rounded border border-white/10 bg-black/50 p-4 text-left text-[12px] leading-relaxed text-stone-400">
                <div className="mb-2 font-bold text-stone-200">Управление</div>
                <p><b className="text-stone-300">WASD</b> — движение · <b className="text-stone-300">Мышь</b> — обзор</p>
                <p><b className="text-stone-300">Shift</b> — ускорение · <b className="text-stone-300">Пробел</b> — прыжок/струи</p>
                <p><b className="text-stone-300">ЛКМ</b> — огонь · <b className="text-stone-300">ПКМ</b> — целиться</p>
                <p><b className="text-stone-300">F</b> — выйти из меха / вернуться · <b className="text-stone-300">Esc</b> — меню</p>
                <p className="mt-1 text-stone-500"><b className="text-stone-400">M</b> — админка баланса (кнопка ⚙ внизу справа)</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HUD во время игры — тот же, что и в превью редактора */}
      {playing && cfg && (
        <PlayHUD
          hud={hud}
          config={cfg}
          objects={objects}
          reticleRef={reticleRef}
          onExit={toMenu}
          onRestart={restartGame}
          onView={viewOf}
          onVision={visionOf}
          onEject={() => engineRef.current?.play?.eject()}
          onEnterMech={(id) => engineRef.current?.play?.enterMech(id)}
          mechs={mechs}
        />
      )}

      {/* экран завершения: победа/поражение */}
      {playing && hud?.over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
          <div className="max-w-md px-6 text-center">
            <div
              className={`mb-2 text-4xl font-black uppercase tracking-widest ${
                hud.over === "won" ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {hud.over === "won" ? "Контракт выполнен" : "Поражение"}
            </div>
            <p className="mb-6 text-[13px] text-stone-400">
              {hud.over === "won"
                ? "Все зоны карты очищены. Отличная работа, водитель!"
                : "Мех уничтожен. Попробуй ещё раз, водитель."}
            </p>
            <div className="flex gap-2">
              <button
                onClick={restartGame}
                className="flex-1 rounded border border-emerald-500/50 bg-emerald-500/15 px-4 py-2.5 text-xs font-black uppercase tracking-widest text-emerald-300 hover:bg-emerald-500/25"
              >
                Заново
              </button>
              <button
                onClick={toMenu}
                className="flex-1 rounded border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-300 hover:border-white/25"
              >
                В меню
              </button>
            </div>
          </div>
        </div>
      )}

      {/* кнопка-шестерёнка: админка (временная) */}
      {playing && !adminOpen && (
        <button
          onClick={() => setAdminOpen(true)}
          title="Админка баланса (M)"
          className="pointer-events-auto absolute bottom-4 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/55 text-base text-stone-400 backdrop-blur transition-all hover:border-amber-500/50 hover:text-amber-300"
        >
          ⚙
        </button>
      )}

      {/* Админка (временная): открывается поверх игры по M, без рестарта */}
      {adminOpen && (
        <div className="pointer-events-none absolute inset-0 z-30">
          <div className="pointer-events-auto absolute right-4 top-4 w-[320px] rounded-xl border border-amber-500/20 bg-stone-950/90 p-4 shadow-2xl backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[12px] font-black uppercase tracking-wider text-amber-300">
                ⚙ Админка
              </div>
              <button
                onClick={() => setAdminOpen(false)}
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20"
              >
                ▶ Продолжить
              </button>
            </div>
            <div className="mb-2 text-[10px] leading-relaxed text-stone-500">
              Применяется сразу, игра не останавливается. M — открыть/закрыть.
            </div>
            {([
              ["mechSpeed", "Скорость меха ×"],
              ["pilotWalk", "Пилот: ходьба ×"],
              ["pilotRun", "Пилот: бег ×"],
              ["dmgFromPlayer", "Урон от игрока ×"],
              ["dmgToPlayer", "Урон по игроку ×"],
              ["enemyHpMul", "Здоровье врагов ×"],
              ["enemyDmgMul", "Урон врагов ×"],
            ] as [keyof AdminVals, string][]).map(([key, label]) => (
              <div key={key} className="mb-2">
                <div className="mb-0.5 flex items-center justify-between">
                  <span className="text-[11px] text-stone-300">{label}</span>
                  <span className="font-mono text-[11px] text-amber-300">{admin[key].toFixed(2)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="range" min={0.1} max={5} step={0.05}
                    value={admin[key]}
                    onChange={(e) => applyAdmin({ [key]: parseFloat(e.target.value) } as Partial<AdminVals>)}
                    className="wf-slider flex-1"
                  />
                  <button
                    onClick={() => applyAdmin({ [key]: 1 } as Partial<AdminVals>)}
                    className="shrink-0 text-[9px] uppercase text-stone-600 hover:text-stone-400"
                  >
                    сброс
                  </button>
                </div>
              </div>
            ))}
            <div className="mb-2 flex gap-1.5">
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(admin, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "wasteland-balance.json";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 4000);
                }}
                className="flex-1 rounded border border-white/10 bg-white/[0.03] py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:border-amber-500/40 hover:text-amber-300"
              >
                Скачать JSON
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 rounded border border-white/10 bg-white/[0.03] py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-300 hover:border-amber-500/40 hover:text-amber-300"
              >
                Импорт JSON
              </button>
              <input
                ref={fileInputRef}
                type="file" accept="application/json,.json"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importAdminJson(f); e.target.value = ""; }}
              />
            </div>
            <button
              onClick={() => { setAdmin(ADMIN_DEFAULTS); applyAdmin(ADMIN_DEFAULTS); }}
              className="mt-1 w-full rounded border border-white/10 bg-white/[0.03] py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400 hover:border-red-500/40 hover:text-red-300"
            >
              Сбросить всё
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Game />
  </StrictMode>
);
