import {
  Copy, Trash2, Focus, ArrowDownToLine, Eye, EyeOff, Lock, Unlock, Download, Film, Upload,
  RotateCcw, Sun, CloudFog, Wind, Sparkles, LayoutGrid, Magnet, BoxSelect,
} from 'lucide-react';
import { useRef } from 'react';
import type { SceneObjectState, EnvState } from '../three/EditorEngine.ts';
import { TIME_PRESETS } from '../three/EditorEngine.ts';
import { getAsset } from '../three/assets.ts';
import { Section, Slider, Vec3, ColorRow, Btn, Toggle } from './ui.tsx';
import { cn } from '../utils/cn.ts';

// ---------------- Inspector ----------------
export function Inspector({ obj, onUpdate, onRole, onDuplicate, onDelete, onFocus, onDrop, types, onAssignType, onExportObject, onImportGlb, selectedCount }: {
  obj: SceneObjectState | null;
  onUpdate: (id: string, patch: Partial<SceneObjectState>, commit?: boolean) => void;
  /** Назначить роль объекту (Мех игрока / Резерв / Враг / Декорация / Спавн). */
  onRole?: (id: string, role: SceneObjectState['role']) => void;
  onDuplicate: () => void; onDelete: () => void; onFocus: () => void; onDrop: () => void;
  types?: { id: string; name: string; role: string; category: string }[];
  onAssignType?: (objectId: string, typeId: string) => void;
  /** Сколько объектов выбрано (для подсказки). */
  selectedCount?: number;
  /** Скачать один объект в .glb (с анимацией походного цикла). */
  onExportObject?: (objectId: string, withAnimation: boolean) => void;
  /** Импортировать .glb как нового меха (временный ассет сессии). */
  onImportGlb?: (file: File) => void;
}) {
  const importGlbRef = useRef<HTMLInputElement | null>(null);
  if (!obj) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <BoxSelect size={36} className="text-stone-700" />
        <div className="mt-3 text-[13px] font-bold text-stone-500">Ничего не выбрано</div>
        <div className="mt-1 max-w-[220px] text-[11px] leading-relaxed text-stone-600">
          Кликните по объекту в сцене или выберите его в иерархии, чтобы редактировать трансформ и материалы
        </div>
        <div className="mt-4 rounded-md border border-white/[0.07] bg-white/[0.02] p-3 text-left text-[10px] leading-relaxed text-stone-500">
          <div><b className="text-stone-400">W</b> — перемещение · <b className="text-stone-400">E</b> — вращение · <b className="text-stone-400">R</b> — масштаб</div>
          <div><b className="text-stone-400">F</b> — фокус · <b className="text-stone-400">G</b> — на землю · <b className="text-stone-400">Del</b> — удалить</div>
          <div><b className="text-stone-400">Ctrl+D</b> — дублировать · <b className="text-stone-400">Ctrl+Z</b> — отмена</div>
        </div>
      </div>
    );
  }
  const asset = getAsset(obj.assetId);
  const multiCount = selectedCount ?? 1;
  return (
    <div className="overflow-y-auto">
      {multiCount > 1 && (
        <div className="border-b border-white/[0.06] bg-amber-500/[0.07] px-3 py-1.5 text-[10px] leading-relaxed text-amber-200">
          Выбрано <b>{multiCount}</b> объектов. Свойства ниже — у активного. Двигать, вращать и масштабировать
          можно всю группу сразу: гизмо висит в её центре.
        </div>
      )}
      <div className="border-b border-white/[0.06] p-3">
        <input
          value={obj.name}
          onChange={(e) => onUpdate(obj.id, { name: e.target.value })}
          onBlur={() => onUpdate(obj.id, {}, true)}
          className="w-full rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-[13px] font-bold text-stone-100 focus:border-amber-500/50 focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">
            {asset?.category} · <span className="font-mono normal-case">{obj.assetId}</span>
          </span>
          <span className="font-mono text-[9px] text-stone-600">{obj.id.slice(0, 12)}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          <Btn title="Дублировать (Ctrl+D)" onClick={onDuplicate}><Copy size={13} /></Btn>
          <Btn title="Фокус (F)" onClick={onFocus}><Focus size={13} /></Btn>
          <Btn title="Опустить на землю (G)" onClick={onDrop}><ArrowDownToLine size={13} /></Btn>
          <Btn title="Удалить (Del)" variant="danger" onClick={onDelete}><Trash2 size={13} /></Btn>
        </div>
        {onExportObject && (
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            <Btn title="Скачать объект .glb — открыть и отредактировать в Blender/Unity/Godot" onClick={() => onExportObject(obj.id, false)}>
              <Download size={13} /> GLB
            </Btn>
            <Btn title="Скачать .glb с запечённой анимацией походного цикла" onClick={() => onExportObject(obj.id, true)}>
              <Film size={13} /> GLB + анимация
            </Btn>
          </div>
        )}
        {onImportGlb && (
          <div className="mt-1.5">
            <input
              ref={importGlbRef}
              type="file" accept=".glb,application/octet-stream"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onImportGlb(f); e.target.value = ""; }}
            />
            <Btn title="Импортировать .glb (из Blender) как временного меха в сцену" onClick={() => importGlbRef.current?.click()}>
              <Upload size={13} /> Импорт GLB (мех)
            </Btn>
          </div>
        )}
        <div className="mt-1 text-[9px] leading-relaxed text-stone-600">
          GLB открывается в Blender, Unity, Unreal, Godot. Меши, материалы и иерархия частей сохраняются; при экспорте с анимацией добавляется клип походного цикла на узлах ног и рук.
        </div>
      </div>

      {types && types.length > 0 && (
        <Section title="Тип объекта">
          <select
            value={obj.typeId ?? ''}
            onChange={(e) => { if (e.target.value) onAssignType?.(obj.id, e.target.value); }}
            className="w-full rounded bg-stone-900 border border-white/10 px-2 py-1.5 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
          >
            <option value="">— тип не назначен —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="mt-1 text-[9px] leading-snug text-stone-500">
            Тип задаёт поведение и модульные настройки объекта. Настройки типов — в панели «Типы объектов».
          </p>
          <p className="mt-1 text-[9px] leading-snug text-stone-600">
            Не путай с «Ролью в превью» (ниже): <b className="text-stone-400">Роль</b> — кем объект становится в игре (кем играешь, враг, точка спавна). <b className="text-stone-400">Тип</b> — из какой сборки он сделан и где появляется. Назначение типа само ставит роль по своему назначению.
          </p>
        </Section>
      )}

      {obj.assetId.startsWith('barrel') && <Section title="Содержимое бочки">
        <select className="w-full rounded bg-stone-900 p-2 text-xs text-stone-200" value={obj.contents ?? (obj.assetId === 'barrel_toxic' ? 'toxic' : 'empty')}
          onChange={(e) => onUpdate(obj.id, { contents: e.target.value as SceneObjectState['contents'] }, true)}>
          <option value="empty">Пустая — сминается</option>
          <option value="fuel">Топливо — взрывается</option>
          <option value="toxic">Опасный состав — взрывается</option>
        </select>
      </Section>}
      <Section title="Трансформ" right={
        <button
          title="Сбросить масштаб и наклон"
          onClick={() => onUpdate(obj.id, { rotation: [0, obj.rotation[1], 0], scale: [1, 1, 1] }, true)}
          className="rounded p-1 text-stone-500 hover:bg-white/10 hover:text-amber-300"
        ><RotateCcw size={12} /></button>
      }>
        <Vec3 label="Позиция" value={obj.position} step={0.1}
          onChange={(v) => onUpdate(obj.id, { position: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <Vec3 label="Вращение (град)" value={obj.rotation} step={5}
          onChange={(v) => onUpdate(obj.id, { rotation: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <div className="mb-1 flex gap-1">
          {[0, 45, 90, 180].map((a) => (
            <button key={a} onClick={() => onUpdate(obj.id, { rotation: [obj.rotation[0], a, obj.rotation[2]] }, true)}
              className="flex-1 rounded border border-white/10 bg-white/[0.03] py-0.5 font-mono text-[10px] text-stone-400 hover:border-amber-500/40 hover:text-amber-300">
              Y:{a}°
            </button>
          ))}
        </div>
        <Vec3 label="Масштаб" value={obj.scale} step={0.05}
          onChange={(v) => onUpdate(obj.id, { scale: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <div className="flex gap-1">
          {[0.5, 1, 2].map((s) => (
            <button key={s} onClick={() => onUpdate(obj.id, { scale: [s, s, s] }, true)}
              className="flex-1 rounded border border-white/10 bg-white/[0.03] py-0.5 font-mono text-[10px] text-stone-400 hover:border-amber-500/40 hover:text-amber-300">
              ×{s}
            </button>
          ))}
          <button onClick={() => { const s = obj.scale[0]; onUpdate(obj.id, { scale: [s, s, s] }, true); }}
            title="Уравнять масштаб"
            className="flex-1 rounded border border-white/10 bg-white/[0.03] py-0.5 text-[10px] font-bold text-stone-400 hover:border-amber-500/40 hover:text-amber-300">
            1:1:1
          </button>
        </div>
      </Section>

      <Section title="Материал — ржавчина и износ">
        <ColorRow label="Оттенок краски" value={obj.tint}
          onChange={(v) => onUpdate(obj.id, { tint: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <div className="mb-1 flex gap-1">
          {['#ffffff', '#c9a06a', '#8a6a4a', '#5a6a5a', '#6a7a8a', '#8a3a2a', '#3a3a3a'].map((c) => (
            <button key={c} onClick={() => onUpdate(obj.id, { tint: c }, true)}
              className={cn('h-5 flex-1 rounded border', obj.tint === c ? 'border-amber-400' : 'border-white/15')}
              style={{ background: c }} />
          ))}
        </div>
        <Slider label="Ржавчина / коррозия" value={obj.rust} min={0} max={1}
          onChange={(v) => onUpdate(obj.id, { rust: v })} onCommit={() => onUpdate(obj.id, {}, true)}
          format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Металличность" value={obj.metalness} min={0} max={1}
          onChange={(v) => onUpdate(obj.id, { metalness: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <Slider label="Шероховатость" value={obj.roughness} min={0} max={1}
          onChange={(v) => onUpdate(obj.id, { roughness: v })} onCommit={() => onUpdate(obj.id, {}, true)} />
        <Slider label="Свечение (лампы, экраны)" value={obj.emissive} min={0} max={3}
          onChange={(v) => onUpdate(obj.id, { emissive: v })} onCommit={() => onUpdate(obj.id, {}, true)}
          format={(v) => `${v.toFixed(1)}×`} />
      </Section>

      <Section title="Состояние">
        <Toggle label="Видимый" icon={obj.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          value={obj.visible} onChange={(v) => onUpdate(obj.id, { visible: v }, true)} />
        <Toggle label="Заблокирован (без гизмо)" icon={obj.locked ? <Lock size={13} /> : <Unlock size={13} />}
          value={obj.locked} onChange={(v) => onUpdate(obj.id, { locked: v }, true)} />
      </Section>

      <Section title="Роль в превью">
        <div className="grid grid-cols-2 gap-1.5">
          {(
            obj.assetId.startsWith('mech_')
              ? ([['player', 'Управляемый мех'], ['reserve', 'Запасной мех'], ['enemy', 'Враг'], ['prop', 'Декорация']] as const)
              : (obj.assetId === 'pilot' || obj.assetId === 'pilot_human' || obj.assetId === 'survivor')
                ? ([['player', 'Пилот игрока'], ['prop', 'NPC — декорация']] as const)
                : ([['enemy', 'Враг'], ['prop', 'Декорация'], ['spawn', 'Точка спавна']] as const)
          ).map(([v, label]) => (
            <button key={v}
              onClick={() => (onRole ? onRole(obj.id, v) : onUpdate(obj.id, { role: v }, true))}
              className={cn(
                'rounded border py-1.5 text-[11px] font-bold transition-all',
                obj.role === v
                  ? v === 'enemy'
                    ? 'border-red-500/60 bg-red-500/15 text-red-300'
                    : v === 'spawn'
                      ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                      : v === 'player'
                        ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-300'
                        : v === 'reserve'
                          ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
                          : 'border-amber-500/60 bg-amber-500/15 text-amber-300'
                  : 'border-white/10 bg-white/[0.03] text-stone-400 hover:border-white/25 hover:text-stone-200'
              )}>
              {label}
            </button>
          ))}
        </div>
        <div className="mt-1.5 text-[10px] leading-relaxed text-stone-500">
          {obj.role === 'player' && (
            (obj.assetId === 'pilot' || obj.assetId === 'pilot_human' || obj.assetId === 'survivor')
              ? 'Старт «Пешком» → управляешь именно этим персонажем. Старт «В мехе» → он ждёт в сцене, клипом по меху садится.'
              : 'Этот мех игрок сядет в кабину при старте превью — он главнее выбора в панели «Мех».'
          )}
          {obj.role === 'reserve' && 'Запасной мех: в превью не водится, остаётся напарником. Игроком станет другой мех.'}
          {obj.role === 'spawn' && 'Здесь игрок появится в превью (точка появления). Режим — панель «Мех» → «Точка появления».'}
          {obj.role === 'enemy' && (
            (obj.assetId === 'turret' || obj.assetId.startsWith('mech_'))
              ? 'В превью атакует игрока. Прочность и урон — вкладка «Сценарий».'
              : 'Оживут только турели и мехи — этот объект останется декорацией.'
          )}
          {obj.role === 'prop' && 'Просто декорация: не едет, не стреляет, стоит на месте. Персонаж с этой ролью — NPC.'}
        </div>
      </Section>
    </div>
  );
}

// ---------------- Environment ----------------
export function EnvironmentPanel({ env, onChange }: {
  env: EnvState; onChange: (patch: Partial<EnvState>) => void;
}) {
  const setPreset = (key: string) => {
    const p = TIME_PRESETS[key];
    if (!p) return;
    const { label: _label, ...rest } = p;
    onChange({ ...rest, timePreset: key });
  };
  return (
    <div className="overflow-y-auto">
      <Section title="Время суток — пресеты">
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(TIME_PRESETS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => setPreset(key)}
              className={cn(
                'rounded-md border px-2 py-2 text-left transition-all',
                env.timePreset === key
                  ? 'border-amber-500/60 bg-amber-500/15'
                  : 'border-white/10 bg-white/[0.03] hover:border-white/25'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="h-3 w-3 rounded-full border border-white/30"
                  style={{ background: (p as { skyColor?: string }).skyColor || '#888' }}
                />
                <span className={cn('text-[11px] font-bold', env.timePreset === key ? 'text-amber-200' : 'text-stone-300')}>
                  {(p as { label: string }).label}
                </span>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Атмосфера пустоши">
        <Slider label="Плотность тумана" value={env.fogDensity} min={0.002} max={0.045}
          onChange={(v) => onChange({ fogDensity: v })} />
        <Slider label="Пыль в воздухе" value={env.dust} min={0} max={1}
          onChange={(v) => onChange({ dust: v })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Яркость солнца" value={env.sunIntensity} min={0} max={5}
          onChange={(v) => onChange({ sunIntensity: v })} format={(v) => `${v.toFixed(1)}`} />
        <Slider label="Угол солнца" value={env.sunAngle} min={0} max={180}
          onChange={(v) => onChange({ sunAngle: v })} format={(v) => `${Math.round(v)}°`} />
        <Slider label="Экспозиция" value={env.exposure} min={0.4} max={1.8}
          onChange={(v) => onChange({ exposure: v })} />
        <ColorRow label="Цвет неба / тумана" value={env.skyColor} onChange={(v) => onChange({ skyColor: v })} />
        <div className="mb-1 flex gap-1">
          {['#c97a2e', '#d8a05a', '#b5431f', '#8a8a7a', '#1a2233', '#4a2a3a'].map((c) => (
            <button key={c} onClick={() => onChange({ skyColor: c })}
              className={cn('h-5 flex-1 rounded border', env.skyColor === c ? 'border-amber-400' : 'border-white/15')}
              style={{ background: c }} />
          ))}
        </div>
        <ColorRow label="Оттенок земли" value={env.groundTint} onChange={(v) => onChange({ groundTint: v })} />
      </Section>
      <Section title="Сетка и привязка">
        <Toggle label="Показать сетку" icon={<LayoutGrid size={13} />} value={env.grid} onChange={(v) => onChange({ grid: v })} />
        <Toggle label="Показать границы коллизий" icon={<BoxSelect size={13} />} value={!!env.showCollisions} onChange={(v) => onChange({ showCollisions: v })} />
        <Toggle label="Привязка (снап)" icon={<Magnet size={13} />} value={env.snap} onChange={(v) => onChange({ snap: v })} />
        <Slider label="Шаг сетки" value={env.snapSize} min={0.1} max={5} step={0.1}
          onChange={(v) => onChange({ snapSize: v })} format={(v) => `${v.toFixed(1)} м`} />
        <div className="mt-1 flex items-center gap-1.5 rounded-md border border-white/[0.07] bg-white/[0.02] p-2 text-[10px] leading-relaxed text-stone-500">
          <Sparkles size={12} className="shrink-0 text-amber-500" />
          Снап: перемещение — {env.snapSize.toFixed(1)} м · вращение — 15° · масштаб — 0.1
        </div>
      </Section>
      <div className="p-3">
        <div className="rounded-md border border-white/[0.07] bg-black/30 p-2.5 text-[10px] leading-relaxed text-stone-500">
          <div className="mb-1 flex items-center gap-1.5 font-bold uppercase tracking-wider text-stone-400">
            <Sun size={11} className="text-amber-500" /> Референс
          </div>
          Для вида как на референсах используйте пресет «Пыльная буря»: плотный оранжевый туман, высокая пыль и низкое солнце.
          <div className="mt-1.5 flex items-center gap-1.5 text-stone-600">
            <CloudFog size={11} /> туман 0.022 · <Wind size={11} /> пыль 100%
          </div>
        </div>
      </div>
    </div>
  );
}
