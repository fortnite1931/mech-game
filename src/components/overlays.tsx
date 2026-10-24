import React from 'react';
import { FileJson, Box, Image as ImageIcon, Upload, Download, Copy, Check } from 'lucide-react';
import type { SceneObjectState, EngineStats } from '../three/EditorEngine.ts';
import { getAsset } from '../three/assets.ts';
import { Btn } from './ui.tsx';
import { cn } from '../utils/cn.ts';

// ---------------- Export modal ----------------
export function ExportModal({ json, onClose, onDownloadJSON, onDownloadGLB, onScreenshot, onImportJSON, exporting }: {
  json: string;
  onClose: () => void;
  onDownloadJSON: () => void;
  onDownloadGLB: (withGround: boolean) => void;
  onScreenshot: (w: number) => void;
  onImportJSON: (text: string) => void;
  exporting: boolean;
}) {
  const [tab, setTab] = React.useState<'json' | 'glb' | 'png' | 'import'>('json');
  const [withGround, setWithGround] = React.useState(true);
  const [res, setRes] = React.useState(1920);
  const [copied, setCopied] = React.useState(false);
  const [paste, setPaste] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(json); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* ignore */ }
  };

  const tabs = [
    { id: 'json', label: 'JSON сцена', icon: <FileJson size={13} /> },
    { id: 'glb', label: 'GLB модель', icon: <Box size={13} /> },
    { id: 'png', label: 'PNG скриншот', icon: <ImageIcon size={13} /> },
    { id: 'import', label: 'Импорт', icon: <Upload size={13} /> },
  ] as const;

  return (
    <div className="p-4">
      <div className="mb-3 flex gap-1.5">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-bold transition-all',
              tab === t.id ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-white/10 bg-white/[0.02] text-stone-400 hover:text-stone-200'
            )}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {tab === 'json' && (
        <div>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-400">
            Полное описание сцены: трансформы, материалы, окружение. Загружается обратно в редактор
            или в игровой движок (Unity/Unreal/Godot через парсер).
          </p>
          <pre className="max-h-[300px] overflow-auto rounded-md border border-white/10 bg-black/50 p-3 font-mono text-[10px] leading-relaxed text-emerald-300/90">
            {json.slice(0, 6000)}{json.length > 6000 ? '\n… (обрезано в предпросмотре)' : ''}
          </pre>
          <div className="mt-3 flex gap-2">
            <Btn variant="primary" className="flex-1" onClick={onDownloadJSON}><Download size={13} /> Скачать .json</Btn>
            <Btn className="flex-1" onClick={copy}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Скопировано!' : 'Копировать'}</Btn>
          </div>
        </div>
      )}

      {tab === 'glb' && (
        <div>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-400">
            Бинарный <b className="text-stone-200">glTF 2.0 (.glb)</b> — вся сцена одним файлом: геометрия,
            PBR-материалы, цвета. Открывается в Blender, Unity, Unreal, Godot, Three.js.
          </p>
          <label className="mb-3 flex cursor-pointer items-center gap-2 rounded-md border border-white/10 bg-white/[0.02] p-2.5 text-[12px] text-stone-300">
            <input type="checkbox" checked={withGround} onChange={(e) => setWithGround(e.target.checked)} className="h-4 w-4 accent-amber-500" />
            Включить ландшафт пустоши (240×240 м)
          </label>
          <Btn variant="primary" className="w-full" disabled={exporting} onClick={() => onDownloadGLB(withGround)}>
            <Download size={13} /> {exporting ? 'Экспорт…' : 'Скачать .glb'}
          </Btn>
          <div className="mt-2 rounded-md border border-white/[0.07] bg-black/30 p-2 text-[10px] text-stone-500">
            Экспорт выполняется локально в браузере. Скрытые объекты не включаются.
          </div>
        </div>
      )}

      {tab === 'png' && (
        <div>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-400">
            Рендер текущего вида камеры в высоком разрешении — для референсов, превью и документации.
          </p>
          <div className="mb-3 grid grid-cols-3 gap-1.5">
            {[1280, 1920, 2560].map((w) => (
              <button key={w} onClick={() => setRes(w)}
                className={cn(
                  'rounded-md border py-2 font-mono text-[11px] font-bold',
                  res === w ? 'border-amber-500/60 bg-amber-500/15 text-amber-200' : 'border-white/10 text-stone-400'
                )}>{w}px</button>
            ))}
          </div>
          <Btn variant="primary" className="w-full" onClick={() => { onScreenshot(res); onClose(); }}>
            <ImageIcon size={13} /> Сохранить скриншот {res}px
          </Btn>
        </div>
      )}

      {tab === 'import' && (
        <div>
          <p className="mb-2 text-[11px] leading-relaxed text-stone-400">
            Загрузите ранее экспортированный JSON сцены. Текущая сцена будет заменена.
          </p>
          <input ref={fileRef} type="file" accept=".json" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = new FileReader();
              r.onload = () => onImportJSON(String(r.result || ''));
              r.readAsText(f);
            }} />
          <Btn className="w-full" onClick={() => fileRef.current?.click()}><Upload size={13} /> Выбрать .json файл</Btn>
          <div className="my-2 text-center text-[10px] text-stone-600">— или вставьте текст —</div>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6}
            placeholder='{"meta": …}'
            className="w-full rounded-md border border-white/10 bg-black/50 p-2 font-mono text-[10px] text-stone-300 focus:border-amber-500/50 focus:outline-none" />
          <Btn variant="success" className="mt-2 w-full" disabled={!paste.trim()} onClick={() => onImportJSON(paste)}>
            Загрузить сцену
          </Btn>
        </div>
      )}
    </div>
  );
}

// ---------------- Minimap ----------------
const DOT_COLORS: Record<string, string> = {
  'Мехи': '#ff7a2e', 'Укрытия': '#b8b3ae', 'Бочки и грузы': '#e8b13c',
  'Металлолом': '#e05a4a', 'База и техника': '#4ad8e0', 'Ландшафт': '#5ae08a',
};

export function Minimap({ objects, selectedId, onSelect, center }: {
  objects: SceneObjectState[]; selectedId: string | null; onSelect: (id: string) => void;
  /** Точка, вокруг которой центрируется карта (игрок или выделенный объект). */
  center?: { x: number; z: number; yaw: number; isPlayer?: boolean } | null;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const RANGE = 55;
  // актуальные данные для отрисовки — карта живая, а не перерисовывается по событию
  const dataRef = React.useRef({ objects, selectedId, center });
  dataRef.current = { objects, selectedId, center };

  React.useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const S = c.width;
    let raf = 0;
    const draw = () => {
      const { objects: objs, selectedId: sel, center: ctr } = dataRef.current;
      const ox = ctr?.x ?? 0;
      const oz = ctr?.z ?? 0;
      // фон
      ctx.fillStyle = 'rgba(20,14,10,0.92)';
      ctx.fillRect(0, 0, S, S);
      // сетка
      ctx.strokeStyle = 'rgba(255,170,80,0.12)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const p = (i / 8) * S;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S, p); ctx.stroke();
      }
      // граница обзора
      ctx.strokeStyle = 'rgba(255,170,80,0.25)';
      ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); ctx.stroke();
      // мировые координаты -> пиксели (относительно центра)
      const toPx = (x: number, z: number): [number, number] => [
        S / 2 + ((x - ox) / RANGE) * (S / 2 - 6),
        S / 2 + ((z - oz) / RANGE) * (S / 2 - 6),
      ];
      // объекты
      objs.forEach((o) => {
        if (!o.visible) return;
        const [px, py] = toPx(o.position[0], o.position[2]);
        if (px < -8 || py < -8 || px > S + 8 || py > S + 8) return;
        const cat = getAsset(o.assetId)?.category || '';
        const isSel = o.id === sel;
        ctx.beginPath();
        ctx.arc(px, py, isSel ? 5 : o.assetId.startsWith('mech_') ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fillStyle = DOT_COLORS[cat] || '#fff';
        ctx.fill();
        if (isSel) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
        // вектор направления у мехов
        if (o.assetId.startsWith('mech_')) {
          const a = (o.rotation[1] * Math.PI) / 180;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.sin(a) * 8, py - Math.cos(a) * 8);
          ctx.strokeStyle = DOT_COLORS[cat];
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
      // метка игрока / центра
      if (ctr) {
        const [px, py] = toPx(ctr.x, ctr.z);
        const a = ctr.yaw;
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-a + Math.PI);
        ctx.beginPath();
        ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5, 6); ctx.closePath();
        ctx.fillStyle = ctr.isPlayer ? '#7cf5b0' : '#ffb060';
        ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
        ctx.restore();
        ctx.beginPath(); ctx.arc(px, py, 14, 0, Math.PI * 2);
        ctx.strokeStyle = ctr.isPlayer ? 'rgba(124,245,176,0.35)' : 'rgba(255,176,96,0.3)';
        ctx.lineWidth = 1; ctx.stroke();
      }
      // север
      ctx.fillStyle = '#ff7a2e';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('N ▲', 6, 12);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const click = (e: React.MouseEvent) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) / r.width) * c.width;
    const my = ((e.clientY - r.top) / r.height) * c.height;
    const ctr = dataRef.current.center;
    const ox = ctr?.x ?? 0;
    const oz = ctr?.z ?? 0;
    let best: string | null = null; let bestD = 12;
    objects.forEach((o) => {
      const px = c.width / 2 + ((o.position[0] - ox) / RANGE) * (c.width / 2 - 6);
      const py = c.width / 2 + ((o.position[2] - oz) / RANGE) * (c.width / 2 - 6);
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) { bestD = d; best = o.id; }
    });
    if (best) onSelect(best);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-amber-500/25 bg-black/60 shadow-2xl">
      <div className="flex items-center justify-between bg-black/60 px-2 py-1">
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-amber-500/80">Тактическая карта</span>
        <span className="font-mono text-[9px] text-stone-500">{objects.length} obj</span>
      </div>
      <canvas ref={ref} width={168} height={168} onClick={click} className="cursor-crosshair" />
    </div>
  );
}

// ---------------- Status bar ----------------
export function StatusBar({ stats, selected, hint }: {
  stats: EngineStats; selected: SceneObjectState | null; hint: string;
}) {
  return (
    <div className="flex h-7 items-center gap-4 overflow-hidden border-t border-white/[0.07] bg-[#0e0c09] px-3 text-[10px] text-stone-500">
      <span className="flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 rounded-full', stats.fps >= 50 ? 'bg-emerald-400' : stats.fps >= 25 ? 'bg-amber-400' : 'bg-red-400')} />
        <b className="font-mono text-stone-300">{stats.fps}</b> FPS
      </span>
      <span className="font-mono">{stats.tris}k tris · {stats.calls} calls · {stats.objects} объектов</span>
      <span className="hidden truncate md:inline">
        {selected ? (
          <>Выбрано: <b className="text-amber-300/90">{selected.name}</b>
            <span className="font-mono text-stone-600"> [{selected.position ? selected.position.map((v) => (v ?? 0).toFixed(1)).join(', ') : '—'}]</span></>
        ) : <span className="text-stone-600">Ничего не выбрано</span>}
      </span>
      <span className="ml-auto hidden truncate text-stone-600 lg:inline">{hint}</span>
    </div>
  );
}
