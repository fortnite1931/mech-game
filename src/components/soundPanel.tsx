import React, { useState, useRef, useCallback } from 'react';
import { Play, StopCircle, FileAudio, Trash2, Plus, Copy, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { audio, type SoundBinding, type SoundAsset } from '../three/audio.ts';
import { Section, Btn, Toggle, Slider } from './ui.tsx';
import { cn } from '../utils/cn.ts';

const SOUND_EVENTS: { id: string; label: string }[] = [
  { id: 'shot.autocannon', label: 'Стрельба — автопушка' },
  { id: 'shot.mg', label: 'Стрельба — пулемёт' },
  { id: 'shot.laser', label: 'Стрельба — лазер' },
  { id: 'shot.missiles', label: 'Стрельба — ракеты' },
  { id: 'explosion', label: 'Взрыв' },
  { id: 'step', label: 'Шаг меха' },
  { id: 'servo', label: 'Поворот туловища' },
  { id: 'zoom', label: 'Прицеливание (зум)' },
  { id: 'crush', label: 'Смятие объекта' },
  { id: 'tree', label: 'Удар по дереву' },
  { id: 'land', label: 'Посадка / приземление' },
  { id: 'overheat', label: 'Перегрев реактора' },
  { id: 'jet', label: 'Силовой прыжок' },
  { id: 'select', label: 'Выбор оружия / UI' },
  { id: 'hit', label: 'Попадание по цели' },
  { id: 'enemyShoot', label: 'Выстрел врага' },
  { id: 'playerHurt', label: 'Ранение игрока' },
  { id: 'win', label: 'Победа' },
  { id: 'lose', label: 'Поражение' },
];

export function SoundPanel({ env, onChange }: { env: any; onChange: (patch: any) => void }) {
  const [uploading, setUploading] = useState<File | null>(null);
  const [newEvent, setNewEvent] = useState<string>('');
  const [newSound, setNewSound] = useState<string>('');
  const [newVolume, setNewVolume] = useState(1);
  const [newSpatial, setNewSpatial] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [filter, setFilter] = useState('');
  const [sortByEvent, setSortByEvent] = useState(false);
  const previewRefs = useRef<Map<string, AudioBufferSourceNode>>(new Map());

  const bindings: SoundBinding[] = env.soundBindings ?? [];
  const assets: SoundAsset[] = audio.getAssets();

  /** Любая правка привязки: проверяем дубли и сразу применяем в движок. */
  const apply = useCallback((next: SoundBinding[]) => {
    audio.setBindings(next);
    onChange({ soundBindings: next });
  }, [onChange]);

  const patchBinding = useCallback((index: number, patch: Partial<SoundBinding>) => {
    const updated = bindings.map((b: SoundBinding, i: number) => (i === index ? { ...b, ...patch } : b));
    apply(updated);
  }, [bindings, apply]);

  /** Переназначить событие или звук у существующей привязки. */
  const reassign = useCallback((index: number, patch: Partial<SoundBinding>) => {
    const target = { ...bindings[index], ...patch };
    const clash = bindings.some((b, i) => i !== index && b.eventId === target.eventId && b.soundId === target.soundId);
    if (clash) { alert('Такая привязка уже есть — выбери другой звук или событие.'); return; }
    apply(bindings.map((b, i) => (i === index ? target : b)));
  }, [bindings, apply]);

  /** Сколько звуков уже висит на этом событии. */
  const countForEvent = useCallback((eventId: string) =>
    bindings.filter((b: SoundBinding) => b.eventId === eventId).length, [bindings]);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('audio/')) return;
    setUploading(file);
    try {
      const ab = await file.arrayBuffer();
      const id = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]/gi, '_') + '_' + Date.now();
      await audio.load(id, file.name, ab);
      onChange({ soundBindings: bindings });
      setUploading(null);
    } catch (err) {
      console.error('Failed to load audio', err);
      setUploading(null);
    }
  }, [bindings, onChange]);

  const removeAsset = useCallback((id: string) => {
    audio.unload(id);
    apply(bindings.filter((b: SoundBinding) => b.soundId !== id));
  }, [bindings, apply]);

  const addBinding = useCallback(() => {
    if (!newEvent || !newSound) return;
    const exists = bindings.some((b: SoundBinding) => b.eventId === newEvent && b.soundId === newSound);
    if (exists) return;
    const nb: SoundBinding = { eventId: newEvent, soundId: newSound, volume: newVolume, spatial: newSpatial };
    apply([...bindings, nb]);
    setNewEvent(''); setNewSound(''); setNewVolume(1); setNewSpatial(false);
  }, [newEvent, newSound, newVolume, newSpatial, bindings, apply]);

  /** Кло�� привязки — чтобы не настраивать одно и то же заново. */
  const duplicateBinding = useCallback((index: number) => {
    const src = bindings[index];
    if (!src) return;
    const copy: SoundBinding = { ...src };
    const twin = bindings.find((b) => b.eventId === src.eventId && b.soundId === src.soundId);
    if (twin) {
      // тот же звук на другое событие — иначе получится дубликат
      const freeEvent = SOUND_EVENTS.find((e) => !bindings.some((b) => b.eventId === e.id && b.soundId === src.soundId));
      if (!freeEvent) { alert('Этот звук уже привязан ко всем доступным событиям.'); return; }
      copy.eventId = freeEvent.id;
    }
    apply([...bindings.slice(0, index + 1), copy, ...bindings.slice(index + 1)]);
    setExpanded(index + 1);
  }, [bindings, apply]);

  const removeBinding = useCallback((index: number) => {
    apply(bindings.filter((_: SoundBinding, i: number) => i !== index));
    if (expanded === index) setExpanded(null);
  }, [bindings, apply, expanded]);

  const startRename = useCallback((id: string, current: string) => {
    setRenaming(id); setRenameText(current);
  }, []);

  const commitRename = useCallback(async (id: string) => {
    const name = renameText.trim();
    if (name) await audio.rename(id, name);
    setRenaming(null); setRenameText('');
    // обновляем панель: список звуков перечитывается из audio
    onChange({ soundBindings: bindings });
  }, [renameText, bindings, onChange]);

  /** Прослушать привязку с её настройками (громкость, тон, обрезка). */
  const previewBinding = useCallback((index: number) => {
    const b = bindings[index];
    if (!b) return;
    stopPreview();
    setPreviewPlaying(`b${index}`);
    try {
      audio.play(b.eventId, undefined);
    } catch {
      setPreviewPlaying(null);
    }
  }, [bindings]);

  const playAsset = useCallback((id: string) => {
    if (previewPlaying === id) { stopPreview(); return; }
    stopPreview();
    setPreviewPlaying(id);
    const ctx = (audio as any).ctx;
    const buffers = (audio as any).buffers;
    const master = (audio as any).master;
    if (!ctx || !buffers || !master) return;
    const buffer = buffers.get(id);
    if (!buffer) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain(); g.gain.value = 0.6;
    src.connect(g); g.connect(master);
    src.start(t);
    if (buffer.duration) src.stop(t + buffer.duration + 0.05);
    src.onended = () => { if (previewPlaying === id) setPreviewPlaying(null); };
    previewRefs.current.set(id, src);
  }, [previewPlaying]);

  const stopPreview = useCallback(() => {
    const src = previewRefs.current.get(previewPlaying!);
    if (src) { try { src.stop(); src.disconnect(); } catch { } previewRefs.current.delete(previewPlaying!); }
    setPreviewPlaying(null);
  }, [previewPlaying]);

  // Порядок и фильтр считаем обычным кодом — индексы остаются валидными после сортировки
  const order = bindings.map((_, i) => i);
  if (sortByEvent) order.sort((a, b) => bindings[a].eventId.localeCompare(bindings[b].eventId) || a - b);
  const q = filter.trim().toLowerCase();
  const visible = q
    ? order.filter((i) => {
      const b = bindings[i];
      const ev = SOUND_EVENTS.find((e) => e.id === b.eventId);
      const asset = assets.find((a) => a.id === b.soundId);
      return (ev?.label ?? b.eventId).toLowerCase().includes(q)
        || (asset?.name ?? b.soundId).toLowerCase().includes(q);
    })
    : order;
  const rows = visible.map((i, n) => {
    const prev = n > 0 ? bindings[visible[n - 1]].eventId : null;
    return { i, b: bindings[i], header: !!sortByEvent && prev !== bindings[i].eventId };
  });

  return (
    <div className="overflow-y-auto p-2">
      <Section title="Загрузить звуковой файл">
        <div className="flex gap-2 items-end">
          <input
            type="file" accept="audio/*"
            onChange={handleFile}
            className="hidden"
          />
          <label className="cursor-pointer flex items-center gap-2 rounded border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-stone-300 hover:border-white/25 hover:bg-white/[0.06]"
            onClick={() => {
              const input = document.querySelector('input[type="file"][accept="audio/*"]') as HTMLInputElement | null;
              if (input) { input.value = ''; input.click(); }
            }}
          >
            <FileAudio size={14} /> {uploading ? `Загрузка… ${uploading.name}` : 'Добавить MP3 / WAV / OGG'}
          </label>
        </div>
        <p className="mt-1 text-[10px] text-stone-500">Поддерживаются MP3, WAV, OGG. Звук будет проигрываться вместо процедурного при привязке к событию.</p>
      </Section>

      <Section title="Загруженные звуки">
        {assets.length === 0 ? (
          <div className="text-[11px] text-stone-500">Нет загруженных звуков</div>
        ) : (
          <div className="space-y-1.5">
            {assets.map((a) => {
              const used = bindings.filter((b: SoundBinding) => b.soundId === a.id).length;
              return (
              <div key={a.id} className="flex items-center gap-2 rounded border border-white/10 bg-white/[0.02] p-2">
                <button
                  onClick={() => playAsset(a.id)}
                  className={cn('flex w-6 h-6 items-center justify-center rounded border transition-colors', previewPlaying === a.id
                    ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                    : 'border-white/10 text-stone-400 hover:border-white/25 hover:text-stone-200')}
                >
                  {previewPlaying === a.id ? <StopCircle size={14} /> : <Play size={14} />}
                </button>
                <div className="flex-1 min-w-0">
                  {renaming === a.id ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => void commitRename(a.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void commitRename(a.id); if (e.key === 'Escape') setRenaming(null); }}
                      className="w-full rounded border border-amber-500/50 bg-black/60 px-1.5 py-0.5 text-[11px] font-bold text-stone-100 focus:outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => startRename(a.id, a.name)}
                      title="Переименовать"
                      className="block max-w-full truncate text-left text-[11px] font-bold text-stone-200 hover:text-amber-300"
                    >
                      {a.name}
                    </button>
                  )}
                  <div className="text-[9px] text-stone-500">
                    {a.duration.toFixed(2)} с · {used > 0 ? `в привязках: ${used}` : 'не используется'}
                  </div>
                </div>
                <Btn title="Переименовать" onClick={() => startRename(a.id, a.name)}><Pencil size={12} /></Btn>
                <Btn variant="danger" onClick={() => removeAsset(a.id)}><Trash2 size={12} /></Btn>
              </div>
              );
            })}
            {assets.length > 0 && (
              <div className="text-[9px] leading-snug text-stone-600">
                Клик по названию — переименовать. Имя сохраняется вместе с файлом и переживает перезагрузку проекта.
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Привязки звуков к событиям">
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          <select
            value={newEvent}
            onChange={(e) => setNewEvent(e.target.value)}
            className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1.5 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          >
            <option value="">Событие</option>
            {SOUND_EVENTS.map((ev) => <option key={ev.id} value={ev.id}>{ev.label}</option>)}
          </select>
          <select
            value={newSound}
            onChange={(e) => setNewSound(e.target.value)}
            className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1.5 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          >
            <option value="">Звук</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <div className="col-span-2 py-0.5">
            <div className="mb-0.5 flex items-center justify-between">
              <span className="text-[10px] font-medium text-stone-400">Громкость</span>
              <span className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[9px] text-amber-300">{Math.round(newVolume * 100)}%</span>
            </div>
            <input
              type="range" min={0} max={1} step={0.05} value={newVolume}
              onChange={(e) => setNewVolume(parseFloat(e.target.value))}
              className="w-full h-1 bg-white/[0.1] rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>
          <Toggle label="3D" value={newSpatial} onChange={setNewSpatial} />
        </div>
        <Btn className="w-full" onClick={addBinding} disabled={!newEvent || !newSound}>
          <Plus size={13} /> Привязать звук
        </Btn>

        {bindings.length === 0 ? (
          <div className="mt-3 text-[11px] text-stone-500">Нет привязок. Процедурные звуки будут использоваться по умолчанию.</div>
        ) : (
          <>
            {/* поиск и порядок */}
            <div className="mt-3 mb-1.5 flex items-center gap-1.5">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Поиск по событию или звуку…"
                className="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-stone-200 placeholder-stone-600 focus:border-amber-500/50 focus:outline-none"
              />
              <Btn onClick={() => setSortByEvent((v) => !v)} title="Сгруппировать привязки по событиям">
                {sortByEvent ? 'По событиям' : 'По порядку'}
              </Btn>
            </div>

            <div className="space-y-1.5">
              {rows.length === 0 && (
                <div className="py-2 text-center text-[11px] text-stone-500">Ничего не найдено по фильтру.</div>
              )}
              {rows.map(({ i, b, header }) => {
                const ev = SOUND_EVENTS.find((e) => e.id === b.eventId);
                const asset = assets.find((a) => a.id === b.soundId);
                const isOpen = expanded === i;
                const trimMax = Math.max(0.5, Math.floor(asset?.duration ?? 10));
                const voicesFull = Math.max(1, Math.round(b.maxVoices ?? 4));
                return (
                  <React.Fragment key={i}>
                  {header && (
                    <div className="mt-2 flex items-center gap-1.5 first:mt-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90">
                        {ev?.label ?? b.eventId}
                      </span>
                      <span className="rounded bg-white/[0.07] px-1 text-[9px] text-stone-400">
                        ×{countForEvent(b.eventId)}
                      </span>
                    </div>
                  )}
                <div className="rounded border border-white/10 bg-white/[0.02]">
                  <div className="flex flex-wrap items-center gap-1 p-1.5">
                    <button
                      onClick={() => setExpanded(isOpen ? null : i)}
                      title="Редактировать: событие, звук, громкость, обрезка"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/10 text-stone-500 hover:border-white/25 hover:text-amber-300"
                    >
                      {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </button>
                    <button
                      onClick={() => previewBinding(i)}
                      title="Прослушать как в игре (с громкостью и тоном)"
                      className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded border transition-colors',
                        previewPlaying === `b${i}` ? 'border-amber-500 bg-amber-500/20 text-amber-300' : 'border-white/10 text-stone-400 hover:border-white/25')}
                    >
                      {previewPlaying === `b${i}` ? <StopCircle size={13} /> : <Play size={13} />}
                    </button>
                    {/* подпись занимает остаток строки и сама обрезается */}
                    <div className="min-w-[70px] flex-1 px-0.5 leading-tight">
                      <div className="truncate text-[10px] font-medium text-stone-400">{ev?.label || b.eventId}</div>
                      <div className="truncate text-[10px] text-stone-300">{asset?.name || b.soundId}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-amber-400">{Math.round((b.volume ?? 1) * 100)}%</span>
                    <button
                      onClick={() => duplicateBinding(i)}
                      title="Дублировать привязку"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03] text-stone-400 transition-all hover:border-white/25 hover:text-stone-200"
                    >
                      <Copy size={12} />
                    </button>
                    <button
                      onClick={() => removeBinding(i)}
                      title="Удалить привязку"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 text-red-300 transition-all hover:bg-red-500/20"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {isOpen && (
                    <div className="space-y-1.5 border-t border-white/[0.07] p-2">
                      {/* ПЕРЕНАЗНАЧЕНИЕ: событие и звук меняются в любой момент */}
                      <div className="rounded border border-amber-500/30 bg-amber-500/[0.05] p-2">
                        <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-400/80">
                          Переназначить
                        </div>
                        <div className="grid grid-cols-2 gap-1.5">
                          <select
                            value={b.eventId}
                            onChange={(e) => reassign(i, { eventId: e.target.value })}
                            title="Событие, на котором звучит этот файл"
                            className="w-full rounded border border-white/10 bg-stone-900 px-1.5 py-1 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                          >
                            {SOUND_EVENTS.map((e) => <option key={e.id} value={e.id}>{e.label} ({countForEvent(e.id)})</option>)}
                          </select>
                          <select
                            value={b.soundId}
                            onChange={(e) => reassign(i, { soundId: e.target.value })}
                            title="Файл, который проигрывается"
                            className="w-full rounded border border-white/10 bg-stone-900 px-1.5 py-1 text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                          >
                            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                          </select>
                        </div>
                        <div className="mt-1 text-[9px] leading-snug text-stone-500">
                          Смена события или файла применяется сразу — все настройки ниже сохраняются.
                        </div>
                      </div>

                      <Slider label="Громкость" value={b.volume ?? 1} min={0} max={1} step={0.05}
                        onChange={(v) => patchBinding(i, { volume: v })} format={(v) => `${Math.round(v * 100)}%`} />

                      <div className="flex items-center gap-2">
                        <Toggle
                          label="Пространственный (3D)"
                          value={!!b.spatial}
                          onChange={(v) => patchBinding(i, { spatial: v })}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Toggle
                          label="Новый обрывает предыдущий"
                          value={!!b.restart}
                          onChange={(v) => patchBinding(i, { restart: v })}
                        />
                        <Toggle
                          label="Зациклить"
                          value={!!b.loop}
                          onChange={(v) => patchBinding(i, { loop: v })}
                        />
                      </div>
                      <Slider label="Скорость / тон" value={b.rate ?? 1} min={0.25} max={4} step={0.05}
                        onChange={(v) => patchBinding(i, { rate: v })} format={(v) => `${v.toFixed(2)}×`} />
                      <Slider label="Обрезать начало, с" value={b.trimStart ?? 0} min={0} max={trimMax} step={0.05}
                        onChange={(v) => patchBinding(i, { trimStart: v })} format={(v) => `${v.toFixed(2)} с`} />
                      <Slider label="Обрезать конец, с" value={b.trimEnd ?? 0} min={0} max={trimMax} step={0.05}
                        onChange={(v) => patchBinding(i, { trimEnd: v })} format={(v) => `${v.toFixed(2)} с`} />
                      <Slider label="Нарастание (fade-in), с" value={b.fadeIn ?? 0} min={0} max={2} step={0.05}
                        onChange={(v) => patchBinding(i, { fadeIn: v })} format={(v) => `${v.toFixed(2)} с`} />
                      <Slider label="Затухание (fade-out), с" value={b.fadeOut ?? 0} min={0} max={2} step={0.05}
                        onChange={(v) => patchBinding(i, { fadeOut: v })} format={(v) => `${v.toFixed(2)} с`} />
                      <Slider label="Пауза между повторами, с" value={b.cooldown ?? 0} min={0} max={5} step={0.05}
                        onChange={(v) => patchBinding(i, { cooldown: v })} format={(v) => `${v.toFixed(2)} с`} />
                      <Slider label="Голосов одновременно" value={voicesFull} min={1} max={8} step={1}
                        onChange={(v) => patchBinding(i, { maxVoices: v })} format={(v) => `${v}`} />
                      <Slider label="Задержка старта, с" value={b.delay ?? 0} min={0} max={2} step={0.05}
                        onChange={(v) => patchBinding(i, { delay: v })} format={(v) => `${v.toFixed(2)} с`} />
                      {voicesFull === 1 && !b.restart && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-stone-500">Голосов 1 — при наложении:</span>
                          <Btn onClick={() => patchBinding(i, { overflow: 'cut' })} className={cn(b.overflow !== 'skip' && 'border-amber-500/60 text-amber-300')}>обрывать</Btn>
                          <Btn onClick={() => patchBinding(i, { overflow: 'skip' })} className={cn(b.overflow === 'skip' && 'border-amber-500/60 text-amber-300')}>пропускать</Btn>
                        </div>
                      )}
                      <p className="text-[9px] leading-snug text-stone-500">
                        Длинный звук размножается — поставьте «Новый обрывает предыдущий» или 1 голос + «обрывать». Не доигрывает — увеличьте «Голосов» или уберите «Обрезать конец».
                      </p>
                    </div>
                  )}
                </div>
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </Section>
    </div>
  );
}
