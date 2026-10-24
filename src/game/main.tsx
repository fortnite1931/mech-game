import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { EditorEngine } from "../three/EditorEngine";
import type { HudState } from "../three/playTypes";

/**
 * Игровой клиент (публикуется на платформах: Яндекс Игры, VK Play и т.п.).
 * В отличие от редактора — без панелей: полноэкранный рендер + меню + HUD.
 * Здесь будут расти: стартовое меню, уровни, катсцены, сохранения, SDK.
 */
function Game() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // движок создаётся один раз на весь сеанс игры
  useEffect(() => {
    if (!hostRef.current || engineRef.current) return;
    const engine = new EditorEngine(hostRef.current, {
      onObjectsChange: () => {},
      onSelect: () => {},
      onStats: () => {},
    });
    engineRef.current = engine;
    engine.init();
    engine.loadDemoScene();
    return () => {
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
      onPointer: () => {},
      onExit: () => setPlaying(false),
    });
    if (ok) {
      setPlaying(true);
      setHud(null);
    }
  };

  const toMenu = () => {
    engineRef.current?.stopPlay();
    setPlaying(false);
    setHud(null);
  };

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
            {showHelp && (
              <div className="mt-4 rounded border border-white/10 bg-black/50 p-4 text-left text-[12px] leading-relaxed text-stone-400">
                <div className="mb-2 font-bold text-stone-200">Управление</div>
                <p><b className="text-stone-300">WASD</b> — движение · <b className="text-stone-300">Мышь</b> — обзор</p>
                <p><b className="text-stone-300">Shift</b> — ускорение · <b className="text-stone-300">Пробел</b> — прыжок/струи</p>
                <p><b className="text-stone-300">ЛКМ</b> — огонь · <b className="text-stone-300">Средняя/ПКМ</b> — целиться</p>
                <p><b className="text-stone-300">F</b> — выйти из меха / вернуться · <b className="text-stone-300">Esc</b> — меню</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* HUD во время игры */}
      {playing && hud && (
        <div className="pointer-events-none absolute inset-0 z-10 select-none">
          {/* прицел */}
          <div className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-amber-300/80 shadow-[0_0_6px_rgba(245,166,35,0.9)]" />

          {/* верхняя панель: состояние машины */}
          <div className="absolute left-4 top-4 rounded-lg border border-white/10 bg-black/55 px-3 py-2 text-[12px] backdrop-blur-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-bold text-stone-100">{hud.chassisName}</span>
              <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-stone-300">
                {Math.round(hud.speedKmh)} км/ч
              </span>
            </div>
            {hud.mechMaxHp ? (
              <div className="mb-1">
                <div className="mb-0.5 text-[10px] uppercase tracking-wider text-stone-500">Корпус</div>
                <div className="h-1.5 w-44 overflow-hidden rounded bg-white/10">
                  <div
                    className="h-full rounded bg-emerald-500 transition-all"
                    style={{ width: `${((hud.mechHp ?? 0) / hud.mechMaxHp) * 100}%` }}
                  />
                </div>
              </div>
            ) : null}
            <div>
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-stone-500">Пилот</div>
              <div className="h-1.5 w-44 overflow-hidden rounded bg-white/10">
                <div
                  className={`h-full rounded transition-all ${hud.php / hud.pmax > 0.3 ? "bg-amber-400" : "bg-red-500"}`}
                  style={{ width: `${(hud.php / Math.max(1, hud.pmax)) * 100}%` }}
                />
              </div>
            </div>
            {hud.heat > 0 && (
              <div className="mt-1 text-[10px] text-stone-500">Тепло: {Math.round(hud.heat * 100)}%</div>
            )}
          </div>

          {/* цель */}
          {hud.target && (
            <div className="absolute left-1/2 top-[18%] -translate-x-1/2 rounded border border-red-500/40 bg-red-950/60 px-3 py-1.5 text-center backdrop-blur-sm">
              <div className="text-[11px] font-bold text-red-300">{hud.target.name}</div>
              <div className="h-1 w-32 overflow-hidden rounded bg-white/10">
                <div className="h-full bg-red-500" style={{ width: `${hud.target.hp * 100}%` }} />
              </div>
            </div>
          )}

          {/* лог */}
          <div className="absolute bottom-4 left-4 max-w-md space-y-0.5 rounded-lg border border-white/10 bg-black/50 px-3 py-2 text-[11px] backdrop-blur-sm">
            {hud.log.slice(0, 4).map((line, i) => (
              <div key={i} className="text-stone-300">{line}</div>
            ))}
          </div>

          {/* кнопки паузы/меню */}
          <div className="pointer-events-auto absolute right-4 top-4 flex gap-2">
            <button
              onClick={toMenu}
              className="rounded border border-white/10 bg-black/55 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-stone-300 transition-all hover:border-red-500/40 hover:text-red-300"
            >
              Esc · В меню
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
