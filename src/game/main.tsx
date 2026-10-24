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
function Game() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<EditorEngine | null>(null);
  const reticleRef = useRef<HTMLDivElement | null>(null);
  const [hud, setHud] = useState<HudState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [objects, setObjects] = useState<SceneObjectState[]>([]);
  const [cfg, setCfg] = useState<MechConfig | null>(null);

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
            {showHelp && (
              <div className="mt-4 rounded border border-white/10 bg-black/50 p-4 text-left text-[12px] leading-relaxed text-stone-400">
                <div className="mb-2 font-bold text-stone-200">Управление</div>
                <p><b className="text-stone-300">WASD</b> — движение · <b className="text-stone-300">Мышь</b> — обзор</p>
                <p><b className="text-stone-300">Shift</b> — ускорение · <b className="text-stone-300">Пробел</b> — прыжок/струи</p>
                <p><b className="text-stone-300">ЛКМ</b> — огонь · <b className="text-stone-300">ПКМ</b> — целиться</p>
                <p><b className="text-stone-300">F</b> — выйти из меха / вернуться · <b className="text-stone-300">Esc</b> — меню</p>
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
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Game />
  </StrictMode>
);
