import React from 'react';
import { Play, Pause, Square, Scissors, Download, Trash2, Film, Info, Gauge, Save, RotateCcw, User } from 'lucide-react';
import type { EditorEngine, MechAnimSettings } from '../three/EditorEngine.ts';
import { DEFAULT_MECH_ANIM } from '../three/EditorEngine.ts';
import { getMechClips, clipForState, type MechAnimState } from '../three/assets.ts';
import * as THREE from 'three';

interface SlicedClip {
  name: string;
  start: number;
  end: number;
  clip: THREE.AnimationClip;
}

/** Состояние меха → строка настройки. */
interface StateRow {
  key: Exclude<keyof MechAnimSettings, 'clipMap'>;
  label: string;
  hint: string;
  state?: MechAnimState;
}

const STATE_ROWS: StateRow[] = [
  { key: 'walk', label: 'Ходьба', hint: 'идёт вперёд', state: 'walk' },
  { key: 'run', label: 'Бег', hint: 'газ + Shift', state: 'run' },
  { key: 'jump', label: 'Прыжок', hint: 'в воздухе', state: 'jump' },
  { key: 'damage', label: 'Ранен', hint: 'урон от 70%', state: 'damaged' },
  { key: 'critical', label: 'На грани', hint: 'урон от 85%', state: 'critical' },
  { key: 'global', label: 'Общая', hint: 'множитель всех клипов' },
  { key: 'idle', label: 'Покой', hint: 'стоит на месте', state: 'idle' },
];

/** Ряд настройки: ползунок + сохранение + сброс. */
function SpeedRow({ label, hint, clip, value, saved, min, max, onChange, onSave, onReset }: {
  label: string;
  hint?: string;
  /** Клип, который играет в этом состоянии (если есть). */
  clip?: string;
  value: number;
  saved: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onSave: () => void;
  onReset: () => void;
}) {
  const dirty = Math.abs(value - saved) > 0.001;
  return (
    <div className="mb-1 flex items-center gap-1.5">
      <span className="w-[92px] shrink-0" title={hint}>
        <span className="block text-[10px] font-semibold text-stone-300">{label}</span>
        {hint && <span className="block truncate text-[8px] text-stone-600">{hint}</span>}
      </span>
      <span className="w-[74px] shrink-0 truncate font-mono text-[9px] text-stone-500" title={clip}>
        {clip ?? '—'}
      </span>
      <input
        type="range" min={min} max={max} step={0.05} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="wf-slider flex-1"
      />
      <span className="w-8 text-right font-mono text-[10px] text-amber-300">{value.toFixed(2)}</span>
      <button
        onClick={onSave}
        disabled={!dirty}
        title={dirty ? 'Записать в проект' : 'Уже сохранено'}
        className={`rounded p-1 transition-all ${
          dirty ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/35' : 'text-stone-700 hover:text-stone-500'
        }`}
      >
        <Save size={11} />
      </button>
      <button
        onClick={onReset}
        title="Сбросить к 1.00"
        className="rounded p-1 text-stone-600 transition-all hover:bg-white/10 hover:text-stone-300"
      >
        <RotateCcw size={11} />
      </button>
    </div>
  );
}

export default function AnimationsPanel({ bridge, selectedId, selectedAssetId, selectedName, selectedRole, selectedAnim }: {
  bridge: EditorEngine | null;
  selectedId: string | null;
  selectedAssetId?: string;
  selectedName?: string;
  selectedRole?: string;
  /** Настройки анимаций выбранного меха (хранятся в объекте сцены). */
  selectedAnim?: MechAnimSettings;
}) {
  const assetId = selectedAssetId ?? '';
  const clips = React.useMemo(() => (assetId ? getMechClips(assetId) : []), [assetId]);
  const [clipName, setClipName] = React.useState('');
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [loop, setLoop] = React.useState(true);
  const [sliced, setSliced] = React.useState<SlicedClip[]>([]);
  const [splitStart, setSplitStart] = React.useState(0);
  const [splitEnd, setSplitEnd] = React.useState(1);
  const [msg, setMsg] = React.useState('');

  const currentClip = clips.find((c) => c.name === clipName);
  const target = selectedId;
  const isPilot = assetId === 'pilot';
  const isMech = (!!assetId && assetId.startsWith('mech_')) || isPilot;

  // Настройки живут у объекта, а не глобально: у каждого меха свои.
  const settings: MechAnimSettings = { ...DEFAULT_MECH_ANIM, ...(selectedAnim ?? {}) };

  const apply = (name: string) => {
    if (!bridge || !target) return;
    const ok = bridge.playAnimation(target, name);
    setMsg(ok ? `Анимация «${name}» включена` : 'Не удалось применить клип');
    setPlaying(ok);
    setClipName(name);
    setTime(0);
  };

  const togglePause = () => {
    if (!bridge || !target) return;
    if (playing) { bridge.stopAnimation(target); setPlaying(false); }
    else apply(clipName);
  };

  const stop = () => {
    if (!bridge || !target) return;
    bridge.stopAnimation(target);
    setPlaying(false);
    setTime(0);
  };

  const onLoop = (v: boolean) => {
    setLoop(v);
    bridge?.setAnimationLoop(v);
  };

  /** Изменить настройку: сразу в объект (живой просмотр). */
  const change = (key: keyof MechAnimSettings, v: number) => {
    if (target) bridge?.setAnimSettings(target, { [key]: v });
  };

  const save = (patch: Partial<MechAnimSettings>) => {
    if (target) bridge?.setAnimSettings(target, patch);
    setMsg('Настройки анимаций записаны в проект');
  };

  /** Ручное назначение «состояние → клип» (пусто — авто по смыслу). */
  const assignClip = (st: MechAnimState, name: string) => {
    const next: NonNullable<MechAnimSettings['clipMap']> = { ...(settings.clipMap ?? {}) };
    if (name) next[st] = name; else delete next[st];
    save({ clipMap: next });
    setMsg(name ? `Состояние «${st}» → клип «${name}» (вручную)` : `Состояние «${st}» → авто`);
  };

  const handleSplit = () => {
    if (!currentClip) return;
    const start = Math.min(splitStart, splitEnd);
    const end = Math.max(splitStart, splitEnd);
    const tracks = currentClip.tracks.map((track) => {
      const nt = track.clone();
      const keep: number[] = [];
      const idx: number[] = [];
      for (let i = 0; i < nt.times.length; i++) {
        if (nt.times[i] >= start && nt.times[i] <= end) { keep.push(nt.times[i]); idx.push(i); }
      }
      nt.times = Float32Array.from(keep.map((t) => t - start));
      const stride = track.getValueSize();
      const values: number[] = [];
      idx.forEach((i) => {
        for (let k = 0; k < stride; k++) values.push(track.values[i * stride + k]);
      });
      nt.values = Float32Array.from(values);
      return nt;
    });
    const name = `${currentClip.name}_${start.toFixed(1)}-${end.toFixed(1)}`;
    const newClip = new THREE.AnimationClip(name, end - start, tracks);
    setSliced((s) => [...s, { name, start, end, clip: newClip }]);
    setMsg(`Нарезано: ${name}`);
  };

  const exportClip = (clip: THREE.AnimationClip) => {
    const data = {
      name: clip.name,
      duration: clip.duration,
      tracks: clip.tracks.map((t) => ({
        name: t.name,
        type: t.ValueTypeName,
        times: Array.from(t.times),
        values: Array.from(t.values),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${clip.name}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const btn = 'flex h-8 items-center justify-center gap-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all disabled:opacity-30';

  if (!isMech) {
    return (
      <div className="p-4 text-[11px] leading-relaxed text-stone-500">
        <div className="mb-2 flex items-center gap-2">
          <Film size={14} className="text-amber-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">Редактор анимаций</span>
        </div>
        Выбери в сцене <b className="text-stone-300">меха</b> (роль «Игрок» или «Резервный»)
        или <b className="text-stone-300">пилота</b> — настройки анимаций хранятся у конкретного объекта, а не для всех сразу.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center gap-2">
        <Film size={14} className="text-amber-400" />
        <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">{isPilot ? 'Анимации пилота' : 'Анимации меха'}</span>
      </div>

      <div className="mb-3 rounded border border-white/[0.07] bg-white/[0.02] p-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-stone-200">
          <User size={12} className="text-amber-400" />
          {selectedName ?? assetId}
        </div>
        <div className="mt-0.5 text-[9px] text-stone-500">
          Роль: <b className="text-stone-400">{selectedRole ?? '—'}</b> · настройки хранятся у этого меха
        </div>
      </div>

      {/* скорость по состояниям */}
      <div className="mb-3 rounded border border-white/[0.06] bg-white/[0.02] p-2">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          <Gauge size={11} /> Скорость по состояниям
        </div>
        {STATE_ROWS.map((row) => {
          const over = row.state ? settings.clipMap?.[row.state] : undefined;
          const auto = row.state ? clipForState(assetId, row.state)?.name : undefined;
          const clip = over ?? auto;
          const saved = settings[row.key] ?? 1;
          return (
            <div key={row.key}>
              <SpeedRow
                label={row.label}
                hint={row.hint}
                clip={clip}
                value={saved}
                saved={saved}
                min={row.key === 'idle' ? 0 : 0.1}
                max={3}
                onChange={(v) => change(row.key, v)}
                onSave={() => save({ [row.key]: settings[row.key] })}
                onReset={() => { change(row.key, row.key === 'idle' ? 1 : 1); save({ [row.key]: 1 }); }}
              />
              {/* ручное назначение клипа — ты сам решаешь, что есть что */}
              {row.state && clips.length > 0 && (
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span className="w-[92px] shrink-0 text-[8px] text-stone-600">клип вручную</span>
                  <select
                    value={over ?? ''}
                    onChange={(e) => assignClip(row.state!, e.target.value)}
                    className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[10px] text-stone-300 focus:border-amber-500/50 focus:outline-none"
                  >
                    <option value="">Авто — по смыслу ({auto ?? 'нет клипа'})</option>
                    {clips.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  {over && <span className="text-[8px] font-bold text-amber-300">ручн.</span>}
                </div>
              )}
            </div>
          );
        })}
        <p className="mt-1 text-[9px] leading-relaxed text-stone-500">
          1.00 — как записано в клипе. Меньше — медленнее, больше — быстрее.
          Клип по состоянию подставляется автоматически, но в поле «клип вручную»
          можно назначить любой — смысл каждой анимации знаешь только ты.
        </p>
        <div className="mt-2 flex gap-1.5">
          <button
            onClick={() => { save({ ...settings }); setMsg('Настройки сохранены'); }}
            className={`${btn} flex-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}
          >
            <Save size={12} /> Сохранить
          </button>
          <button
            onClick={() => {
              const d = { ...DEFAULT_MECH_ANIM };
              save(d);
              setMsg('Настройки сброшены');
            }}
            className={`${btn} border-white/10 bg-white/[0.03] text-stone-400 hover:border-red-500/40 hover:text-red-300`}
          >
            <RotateCcw size={12} /> Сброс
          </button>
        </div>
      </div>

      {/* просмотр клипов */}
      <div className="mb-3">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          Клипы меха ({clips.length})
        </div>
        <div className="space-y-1">
          {clips.length === 0 && (
            <div className="rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[11px] text-stone-600">
              У этого меха нет клипов
            </div>
          )}
          {clips.map((c) => (
            <button
              key={c.name}
              onClick={() => apply(c.name)}
              className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left transition-all ${
                clipName === c.name
                  ? 'border-amber-500/60 bg-amber-500/10'
                  : 'border-white/[0.06] bg-white/[0.02] hover:border-white/15'
              }`}
            >
              <span className="truncate font-mono text-[11px] text-stone-200">{c.name}</span>
              <span className="shrink-0 font-mono text-[10px] text-stone-500">{c.duration.toFixed(2)}с</span>
            </button>
          ))}
        </div>
      </div>

      {/* транспорт */}
      <div className="mb-3 flex gap-1.5">
        <button onClick={() => apply(clipName)} disabled={!clipName || !target} className={`${btn} flex-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20`}>
          <Play size={12} /> Старт
        </button>
        <button onClick={togglePause} disabled={!target} className={`${btn} flex-1 border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20`}>
          {playing ? <Pause size={12} /> : <Play size={12} />} {playing ? 'Пауза' : 'Продолжить'}
        </button>
        <button onClick={stop} disabled={!target} className={`${btn} flex-1 border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20`}>
          <Square size={12} /> Стоп
        </button>
      </div>

      {/* таймлайн */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Таймлайн</span>
          <span className="font-mono text-[10px] text-amber-300">
            {time.toFixed(2)}с / {currentClip ? currentClip.duration.toFixed(2) : '0.00'}с
          </span>
        </div>
        <input
          type="range" min={0} max={currentClip?.duration ?? 1} step={0.01} value={Math.min(time, currentClip?.duration ?? 1)}
          onChange={(e) => {
            const t = parseFloat(e.target.value);
            setTime(t);
            if (target) bridge?.setAnimationTime(target, t);
          }}
          className="wf-slider w-full"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Режим</div>
            <button
              onClick={() => onLoop(!loop)}
              className={`h-7 w-full rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${
                loop ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-300' : 'border-white/10 bg-white/[0.03] text-stone-500'
              }`}
            >
              {loop ? 'Зациклено' : 'Один раз'}
            </button>
          </div>
        </div>
      </div>

      {/* нарезка */}
      <div className="mb-3 rounded border border-white/[0.06] bg-white/[0.02] p-2">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          <Scissors size={11} /> Нарезка клипа
        </div>
        <div className="mb-2 grid grid-cols-2 gap-2">
          <div>
            <div className="mb-0.5 text-[9px] text-stone-600">Начало (с)</div>
            <input type="number" step={0.1} value={splitStart} onChange={(e) => setSplitStart(parseFloat(e.target.value) || 0)} className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-200 outline-none focus:border-amber-500/50" />
          </div>
          <div>
            <div className="mb-0.5 text-[9px] text-stone-600">Конец (с)</div>
            <input type="number" step={0.1} value={splitEnd} onChange={(e) => setSplitEnd(parseFloat(e.target.value) || 0)} className="w-full rounded border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-200 outline-none focus:border-amber-500/50" />
          </div>
        </div>
        <button onClick={handleSplit} disabled={!currentClip} className={`${btn} w-full border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20`}>
          Нарезать
        </button>
      </div>

      {/* нарезанные */}
      {sliced.length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Нарезки</div>
          <div className="space-y-1">
            {sliced.map((s, i) => (
              <div key={i} className="flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[10px] text-stone-300">{s.name}</div>
                  <div className="text-[9px] text-stone-600">{s.start.toFixed(1)}с — {s.end.toFixed(1)}с · {(s.end - s.start).toFixed(2)}с</div>
                </div>
                <button onClick={() => exportClip(s.clip)} className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-amber-300" title="Экспорт JSON"><Download size={11} /></button>
                <button onClick={() => setSliced((a) => a.filter((_, j) => j !== i))} className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-red-400" title="Удалить"><Trash2 size={11} /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* инфо о клипе */}
      {currentClip && (
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2">
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            <Info size={11} /> Клип
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px]">
            <span className="text-stone-500">Треков:</span><span className="font-mono text-stone-300">{currentClip.tracks.length}</span>
            <span className="text-stone-500">Ключей:</span><span className="font-mono text-stone-300">{currentClip.tracks.reduce((n, t) => n + t.times.length, 0)}</span>
            <span className="text-stone-500">Длительность:</span><span className="font-mono text-stone-300">{currentClip.duration.toFixed(3)}с</span>
          </div>
          <button onClick={() => exportClip(currentClip)} className={`${btn} mt-2 w-full border-white/10 bg-white/[0.03] text-stone-400 hover:border-amber-500/40 hover:text-amber-300`}>
            <Download size={11} /> Экспорт JSON
          </button>
        </div>
      )}

      {msg && <div className="mt-2 rounded border border-white/[0.06] bg-white/[0.02] px-2 py-1.5 text-[10px] text-stone-400">{msg}</div>}
    </div>
  );
}
