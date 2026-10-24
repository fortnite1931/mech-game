import React from 'react';
import { Save, FolderOpen, Trash2, RotateCcw, HardDriveDownload, Plus, Music } from 'lucide-react';
import { Section, Btn, Toggle } from './ui.tsx';
import { cn } from '../utils/cn.ts';
import { formatBytes, formatTime, type StoredProject } from '../game/projectStore.ts';

export interface SavesPanelProps {
  currentName: string;
  onRename: (name: string) => void;
  saved: StoredProject[];
  autosave: boolean;
  autosaveAt: string;
  onAutosaveChange: (v: boolean) => void;
  onSave: () => void;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onRestoreAutosave: () => void;
  onSaveFile: () => void;
  onLoadFile: (text: string) => void;
}

/**
 * Панель сохранений — аналог «файлов проекта» в Construct 3.
 * Хранилище: IndexedDB (без лимита 5 МБ), поэтому звуки, логика и объекты
 * сохраняются вместе и восстанавливаются одним кликом.
 */
export function SavesPanel({
  currentName, onRename, saved, autosave, autosaveAt, onAutosaveChange,
  onSave, onLoad, onDelete, onRestoreAutosave, onSaveFile, onLoadFile,
}: SavesPanelProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);

  return (
    <div className="h-full overflow-y-auto">
      <Section title="Текущий проект">
        <input
          value={currentName}
          onChange={(e) => onRename(e.target.value.replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 40))}
          placeholder="Имя проекта"
          className="mb-2 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-[12px] text-stone-100 focus:border-amber-500/50 focus:outline-none"
        />
        <div className="flex gap-1.5">
          <Btn variant="primary" className="flex-1" onClick={onSave} title="Сохранить всё: сцену, типы, логику, звуки">
            <Save size={13} /> Сохранить
          </Btn>
          <Btn className="flex-1" onClick={() => fileRef.current?.click()} title="Открыть файл проекта .wasteland.json с диска">
            <FolderOpen size={13} /> Открыть
          </Btn>
        </div>
        <input
          ref={fileRef} type="file" accept=".json,.wasteland,.wfproj,application/json" className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            onLoadFile(await f.text());
          }}
        />
        <div className="mt-1.5 flex gap-1.5">
          <Btn className="flex-1" onClick={onSaveFile} title="Скачать проект одним файлом — перенести на другой ПК">
            <HardDriveDownload size={13} /> Скачать файл
          </Btn>
        </div>
        <div className="mt-2 rounded-md border border-white/[0.07] bg-black/25 p-2 text-[10px] leading-relaxed text-stone-500">
          Сохраняется целиком: объекты сцены, типы и поведения, листы событий, переменные,
          мир, окружение, настройки меха и <b className="text-stone-400">все звуки с привязками к событиям</b>.
          Хранится в IndexedDB браузера — лимит 5 МБ localStorage здесь не мешает.
        </div>
      </Section>

      <Section title="Автосохранение">
        <Toggle label="Сохранять автоматически раз в минуту" value={autosave} onChange={onAutosaveChange} />
        <div className="mt-1 text-[10px] text-stone-500">
          {autosave ? (autosaveAt ? `Последнее: ${autosaveAt}` : 'Будет сохранено через минуту') : 'Выключено'}
        </div>
        <Btn className="mt-2 w-full" onClick={onRestoreAutosave} title="Вернуть состояние на момент автосохранения">
          <RotateCcw size={13} /> Восстановить автосохранение
        </Btn>
      </Section>

      <Section title={`Сохранённые проекты (${saved.length})`}>
        {saved.length === 0 && (
          <div className="mb-2 rounded-md border border-white/10 bg-white/[0.02] p-2 text-[11px] text-stone-500">
            Пока пусто. Нажми «Сохранить» — проект появится здесь.
          </div>
        )}
        {saved.map((p) => (
          <div
            key={p.id}
            className={cn(
              'mb-1.5 rounded-md border p-2 transition-colors',
              p.id === currentName ? 'border-amber-500/50 bg-amber-500/[0.07]' : 'border-white/10 bg-white/[0.02] hover:border-white/20',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="flex-1 truncate text-[11px] font-bold text-stone-100">{p.name}</span>
              {p.id === currentName && (
                <span className="rounded bg-amber-500/25 px-1 py-0.5 text-[9px] font-bold uppercase text-amber-200">открыт</span>
              )}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[9px] text-stone-500">
              <span>{formatTime(p.updatedAt)}</span>
              <span>{formatBytes(p.bytes)}</span>
              <span>объектов: {p.objects}</span>
              {p.sounds > 0 && (
                <span className="flex items-center gap-0.5 text-emerald-400/80">
                  <Music size={8} /> звуков: {p.sounds}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex gap-1">
              <Btn className="flex-1" onClick={() => onLoad(p.id)} title="Загрузить проект целиком">
                <FolderOpen size={11} /> Загрузить
              </Btn>
              <button
                onClick={() => { if (confirm(`Удалить «${p.name}»?`)) onDelete(p.id); }}
                className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-stone-500 transition-all hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-300"
                title="Удалить сохранение"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        ))}
        <div className="mt-1 flex items-start gap-1.5 rounded-md border border-white/[0.07] bg-black/25 p-2 text-[10px] leading-relaxed text-stone-600">
          <Plus size={11} className="mt-0.5 shrink-0" />
          Новая версия того же проекта перезаписывает слот — как «Сохранить проект» в Construct 3.
          Для отдельной копии дай другое имя.
        </div>
      </Section>
    </div>
  );
}
