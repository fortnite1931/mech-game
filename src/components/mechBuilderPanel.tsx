import React from 'react';
import {
  Bot, Ruler, Brush, Eraser, Waves, Magnet, Save, RotateCcw, Eye, EyeOff,
  Plus, Trash2, Copy, Square, Sparkles, Move, RotateCw, Maximize, Zap,
} from 'lucide-react';
import { Section, Slider, Btn, Toggle } from './ui.tsx';
import { cn } from '../utils/cn.ts';
import {
  PART_LABELS, mechSpecFor, MECH_DEFAULTS, PART_PRESETS,
  type BrushMode, type BrushSettings, type MechSpec, type PartId, type PartPreset,
} from '../three/mechRig.ts';

const PART_ORDER: PartId[] = ['torso', 'head', 'arm_L', 'arm_R', 'leg_L', 'leg_R', 'weapon_L', 'weapon_R'];

const BRUSHES: { id: BrushMode; label: string; icon: React.ReactNode; hint: string }[] = [
  { id: 'inflate', label: 'Раздуть', icon: <Plus size={13} />, hint: 'Вытягивает поверхность наружу по нормали' },
  { id: 'deflate', label: 'Втянуть', icon: <Square size={13} />, hint: 'Вдавливает поверхность внутрь' },
  { id: 'smooth', label: 'Сгладить', icon: <Waves size={13} />, hint: 'Убирает шум и бугристость' },
  { id: 'pinch', label: 'Стянуть', icon: <Magnet size={13} />, hint: 'Стягивает геометрию к центру кисти' },
];

const PRESET_GROUPS: { label: string; partId: PartId; ids: string[] }[] = [
  { label: 'Ноги', partId: 'leg_L', ids: ['legs_light', 'legs_heavy', 'legs_long', 'legs_stalk'] },
  { label: 'Руки', partId: 'arm_L', ids: ['arms_cannon', 'arms_missile', 'arms_shield', 'arms_smg'] },
  { label: 'Корпус', partId: 'torso', ids: ['torso_light', 'torso_heavy', 'torso_wide'] },
  { label: 'Кабина', partId: 'head', ids: ['cabin_visor', 'cabin_sensor', 'cabin_capsule'] },
  { label: 'Оружие', partId: 'weapon_L', ids: ['weapon_gun', 'weapon_missile', 'weapon_laser'] },
];

export function MechBuilderPanel({
  objectId, objectName, assetId, spec, onChange,
  brush, onBrushChange, brushMode, onBrushMode, onApplyBrush, onResetSculpt,
  onSaveVariant, onApplyToAll, onApplyPreset,
  activePart, onSelectPart, onDeselectPart,
  onTransformMode,
}: {
  objectId: string | null;
  objectName: string;
  assetId?: string;
  spec: MechSpec;
  onChange: (patch: Partial<MechSpec>) => void;
  brush: BrushSettings;
  onBrushChange: (patch: Partial<BrushSettings>) => void;
  brushMode: BrushMode;
  onBrushMode: (m: BrushMode) => void;
  onApplyBrush: () => void;
  onResetSculpt: () => void;
  onSaveVariant: () => void;
  onApplyToAll: () => void;
  onApplyPreset: (preset: PartPreset) => void;
  activePart: PartId | null;
  onSelectPart: (p: PartId | null) => void;
  onDeselectPart: () => void;
  onTransformMode: (m: 'translate' | 'rotate' | 'scale') => void;
}) {
  const part = spec.parts[activePart ?? 'torso'];

  const setPart = (patch: Partial<MechSpec['parts'][PartId]>) => {
    if (!activePart) return;
    onChange({ parts: { ...spec.parts, [activePart]: { ...spec.parts[activePart], ...patch } } });
  };
  const setVec = (key: 'pos' | 'rot' | 'scale', axis: 0 | 1 | 2, v: number) => {
    if (!activePart) return;
    const cur = [...spec.parts[activePart][key]] as [number, number, number];
    cur[axis] = v;
    setPart({ [key]: cur });
  };
  const resetSpec = () => onChange(mechSpecFor(assetId ?? 'mech_scout'));

  return (
    <div className="overflow-y-auto">
      {!objectId ? (
        <div className="p-4 text-center">
          <Bot size={30} className="mx-auto text-stone-700" />
          <div className="mt-2 text-[12px] font-bold text-stone-400">Мех не выбран</div>
          <div className="mt-1 text-[10px] leading-relaxed text-stone-600">
            Выбери объект меха в сцене или в иерархии — откроется конструктор: размеры,
            детали корпуса и скульптинг поверхности.
          </div>
        </div>
      ) : (
        <>
          <div className="border-b border-white/[0.06] p-3">
            <div className="text-[10px] uppercase tracking-wider text-stone-500">Редактируется</div>
            <div className="text-[13px] font-bold text-amber-300">{objectName}</div>
            <div className="mt-1 text-[10px] text-stone-500">{MECH_DEFAULTS[assetId ?? ''] ? 'Собственные пропорции меха' : 'Стандартный риг'}</div>
            <div className="mt-1.5 flex gap-1.5">
              <Btn className="flex-1" onClick={onSaveVariant} title="Сохранить как отдельную модель в библиотеку">
                <Save size={12} /> Вариант
              </Btn>
              <Btn className="flex-1" onClick={onApplyToAll} title="Применить эти размеры ко всем мехам этого типа">
                <Copy size={12} /> На все
              </Btn>
            </div>
          </div>

          <Section title="Общие размеры">
            <Slider label="Общий масштаб" value={spec.size} min={0.4} max={2.5} step={0.05}
              onChange={(v) => onChange({ size: v })} format={(v) => `${v.toFixed(2)}×`} />
            <Slider label="Ширина корпуса, м" value={spec.width} min={1} max={6} step={0.1}
              onChange={(v) => onChange({ width: v })} format={(v) => v.toFixed(1)} />
            <Slider label="Длина корпуса, м" value={spec.depth} min={0.8} max={5} step={0.1}
              onChange={(v) => onChange({ depth: v })} format={(v) => v.toFixed(1)} />
            <Slider label="Высота корпуса, м" value={spec.torsoHeight} min={1} max={6} step={0.1}
              onChange={(v) => onChange({ torsoHeight: v })} format={(v) => v.toFixed(1)} />
            <Slider label="Длина ноги, м" value={spec.legLength} min={1} max={7} step={0.1}
              onChange={(v) => onChange({ legLength: v })} format={(v) => v.toFixed(1)} />
            <Slider label="Толщина ног, м" value={spec.legThick} min={0.2} max={1.6} step={0.05}
              onChange={(v) => onChange({ legThick: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Толщина рук, м" value={spec.armThick} min={0.15} max={1.4} step={0.05}
              onChange={(v) => onChange({ armThick: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Наклон корпуса, °" value={spec.torsoLean} min={-20} max={35} step={1}
              onChange={(v) => onChange({ torsoLean: v })} format={(v) => `${Math.round(v)}°`} />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-stone-400">
                Броня
                <input type="color" value={spec.armorColor} onChange={(e) => onChange({ armorColor: e.target.value })}
                  className="mt-0.5 h-7 w-full cursor-pointer rounded border border-white/15 bg-transparent" />
              </label>
              <label className="text-[10px] text-stone-400">
                Детали
                <input type="color" value={spec.accentColor} onChange={(e) => onChange({ accentColor: e.target.value })}
                  className="mt-0.5 h-7 w-full cursor-pointer rounded border border-white/15 bg-transparent" />
              </label>
            </div>
            <Btn className="mt-2 w-full" onClick={resetSpec} title="Вернуть пропорции этого меха по умолчанию">
              <RotateCcw size={12} /> Сбросить пропорции
            </Btn>
          </Section>

          <Section title="Пресеты деталей">
            <p className="text-[10px] text-stone-500 mb-1">Готовые пропорции деталей — клик применит к выбранной паре (левая/правая symmetriчно):</p>
            <div className="grid grid-cols-2 gap-1">
              {PRESET_GROUPS.map((g) => (
                <div key={g.label} className="mb-1">
                  <div className="mb-1 text-[10px] font-bold text-stone-400 uppercase tracking-wider">{g.label}</div>
                  <div className="grid grid-cols-2 gap-0.5">
                    {g.ids.map((pid) => {
                      const preset = PART_PRESETS.find((p) => p.id === pid)!;
                      return (
                        <button key={pid} onClick={() => onApplyPreset(preset)}
                          className="flex flex-col items-center gap-0.5 rounded border border-white/10 bg-black/30 px-1 py-1 text-[10px] font-bold text-stone-200 hover:border-amber-500/60 hover:bg-amber-500/10 transition-all">
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Части меха">
            <div className="grid grid-cols-2 gap-1">
              {PART_ORDER.map((id) => {
                const p = spec.parts[id];
                const on = activePart === id;
                return (
                  <div key={id} className={cn('flex items-center gap-1 rounded border px-1.5 py-1',
                    on ? 'border-amber-500/70 bg-amber-500/15' : 'border-white/10 bg-white/[0.02]')}>
                    <button onClick={() => onSelectPart(on ? null : id)}
                      className="flex-1 truncate text-left text-[10px] font-bold text-stone-200">
                      {on ? '✕ ' : ''}{PART_LABELS[id]}
                    </button>
                    <button onClick={() => onChange({ parts: { ...spec.parts, [id]: { ...p, visible: !p.visible } } })}
                      title={p.visible ? 'Скрыть деталь' : 'Показать деталь'}
                      className="shrink-0 text-stone-500 hover:text-amber-300">
                      {p.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </Section>

          {activePart && part && (
            <Section title={`Деталь: ${PART_LABELS[activePart]} ${activePart ? '· гизмо на деталь' : ''}`}>
              <div className="mb-2 flex gap-1">
                <Btn className="flex-1" onClick={() => onTransformMode('translate')}
                  title="Переместить деталь">
                  <Move size={11} /> Переместить
                </Btn>
                <Btn className="flex-1" onClick={() => onTransformMode('rotate')}
                  title="Повернуть деталь">
                  <RotateCw size={11} /> Повернуть
                </Btn>
                <Btn className="flex-1" onClick={() => onTransformMode('scale')}
                  title="Масштаб детали">
                  <Maximize size={11} /> Масштаб
                </Btn>
                <Btn className="flex-1" onClick={onDeselectPart}
                  title="Снять выделение детали (гезмо на весь мех)">
                  <Zap size={11} /> Снять
                </Btn>
              </div>
              <div className="mb-2 text-[10px] text-stone-500">
                Гизмо на детали — схвати и перетаскивай её в сцене. Значения записываются в пропорции.
              </div>
              {([['Смещение', 'pos', -24, 24, 0.05], ['Поворот °', 'rot', -180, 180, 1], ['Масштаб', 'scale', 0.1, 5, 0.05]] as const).map(([label, key, min, max, step]) => (
                <div key={key} className="mb-2">
                  <div className="mb-1 text-[10px] text-stone-400">{label}</div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['X', 'Y', 'Z'] as const).map((ax, i) => (
                      <label key={ax} className="flex items-center gap-0.5 rounded border border-white/10 bg-black/40 px-1">
                        <span className="font-mono text-[9px] text-stone-500">{ax}</span>
                        <input
                          type="number" min={min} max={max} step={step} value={part[key][i]}
                          onChange={(e) => setVec(key, i as 0 | 1 | 2, parseFloat(e.target.value || '0'))}
                          className="w-full bg-transparent px-0.5 py-1 font-mono text-[10px] text-stone-200 focus:outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <Toggle label="Деталь видима" value={part.visible} onChange={(v) => setPart({ visible: v })} />
            </Section>
          )}

          <Section title="Скульптинг">
            <div className="mb-2 grid grid-cols-2 gap-1.5">
              {BRUSHES.map((b) => (
                <button key={b.id} onClick={() => onBrushMode(b.id)} title={b.hint}
                  className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] font-bold transition-all',
                    brushMode === b.id ? 'border-amber-500/70 bg-amber-500/20 text-amber-200' : 'border-white/10 bg-white/[0.03] text-stone-300 hover:border-white/25')}>
                  {b.icon} {b.label}
                </button>
              ))}
            </div>
            <Slider label="Радиус кисти, м" value={brush.radius} min={0.05} max={3} step={0.05}
              onChange={(v) => onBrushChange({ radius: v })} format={(v) => v.toFixed(2)} />
            <Slider label="Сила, %" value={brush.strength} min={0.05} max={1} step={0.05}
              onChange={(v) => onBrushChange({ strength: v })} format={(v) => `${Math.round(v * 100)}%`} />
            <Slider label="Мягкость края" value={brush.falloff} min={0.5} max={4} step={0.1}
              onChange={(v) => onBrushChange({ falloff: v })} format={(v) => v.toFixed(1)} />
            <div className="mt-1.5 flex gap-1.5">
              <Btn variant="primary" className="flex-1" onClick={onApplyBrush}
                title="Кликни по меху в сцене — там же применится кисть">
                <Brush size={12} /> Кисть по клику
              </Btn>
              <Btn className="flex-1" onClick={onResetSculpt} title="Вернуть исходную форму меха">
                <Eraser size={12} /> Сбросить
              </Btn>
            </div>
            <div className="mt-1.5 text-[10px] leading-relaxed text-stone-500">
              Кисть работает по вершинам в радиусе с мягким затуханием: наращивай броню,
              вминай панели, сглаживай фаски. «Сбросить» возвращает геометрию к исходной.
            </div>
          </Section>

          <Section title="Детали и варианты">
            <div className="grid grid-cols-2 gap-1.5">
              <Btn onClick={onSaveVariant} title="Сохранить текущие пропорции как отдельный вариант меха">
                <Sparkles size={12} /> Новый вариант
              </Btn>
              <Btn onClick={onApplyToAll} title="Применить размеры ко всем мехам в сцене">
                <Ruler size={12} /> Применить ко всем
              </Btn>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <Btn variant="danger" onClick={() => {
                const id = activePart ?? 'torso';
                onChange({ parts: { ...spec.parts, [id]: { ...spec.parts[id], visible: false } } });
              }} title="Убрать выбранную деталь">
                <Trash2 size={12} /> Убрать деталь
              </Btn>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
