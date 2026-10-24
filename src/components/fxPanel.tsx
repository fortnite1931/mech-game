import React from 'react';
import { CloudFog, Sparkles, Sun, Mountain, Boxes, Wand2, Layers } from 'lucide-react';
import { Section, Toggle, Btn } from './ui.tsx';

export interface EffectFlags {
  dust: boolean;
  fog: boolean;
  sky: boolean;
  sun: boolean;
  shadows: boolean;
  postfx: boolean;
  ground: boolean;
}

const EFFECTS: { key: keyof EffectFlags; label: string; desc: string; icon: React.ReactNode }[] = [
  { key: 'dust', label: 'Пыль', desc: 'Взвешенные частицы в воздухе. Мешают видеть сетку и мелкую геометрию.', icon: <Sparkles size={12} /> },
  { key: 'fog', label: 'Туман и дымка', desc: 'Плотность тумана обнуляется — сцена становится резкой до горизонта.', icon: <CloudFog size={12} /> },
  { key: 'sky', label: 'Небо и купол', desc: 'Градиентное небо над сценой.', icon: <Layers size={12} /> },
  { key: 'sun', label: 'Солнце', desc: 'Направленный свет. Выключи, чтобы оценивать материалы без засветки.', icon: <Sun size={12} /> },
  { key: 'shadows', label: 'Тени', desc: 'Отбрасываемые тени. Отключай при больших сценах — заметно ускоряет работу.', icon: <Boxes size={12} /> },
  { key: 'postfx', label: 'Пост-обработка', desc: 'Блум, виньетка, ночное видение и тепловизор в превью.', icon: <Wand2 size={12} /> },
  { key: 'ground', label: 'Земля', desc: 'Плоскость земли и её цвет. Можно скрыть, чтобы видеть только объекты.', icon: <Mountain size={12} /> },
];

const ALL_ON: EffectFlags = { dust: true, fog: true, sky: true, sun: true, shadows: true, postfx: true, ground: true };

export function EffectsPanel({ env, onChange }: { env: any; onChange: (patch: any) => void }) {
  const fx: EffectFlags = { ...ALL_ON, ...(env.fx ?? {}) };

  const setFx = (key: keyof EffectFlags, value: boolean) => {
    onChange({ fx: { ...fx, [key]: value } });
  };

  const enabledCount = EFFECTS.filter((e) => fx[e.key]).length;

  return (
    <div>
      <Section title="Видимость эффектов">
        <div className="space-y-1">
          {EFFECTS.map((e) => (
            <div key={e.key} className="rounded border border-white/[0.07] bg-white/[0.02] px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-stone-500">{e.icon}</span>
                <span className="flex-1 text-[11px] font-semibold text-stone-200">{e.label}</span>
                <Toggle label={fx[e.key] ? 'вкл' : 'выкл'} value={!!fx[e.key]} onChange={(v) => setFx(e.key, v)} />
              </div>
              <p className="mt-0.5 text-[9px] leading-snug text-stone-500">{e.desc}</p>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Btn onClick={() => onChange({ fx: ALL_ON })}>Включить всё</Btn>
          <Btn variant="danger" onClick={() => onChange({ fx: Object.fromEntries(EFFECTS.map((e) => [e.key, false])) as unknown as EffectFlags })}>
            Выключить всё
          </Btn>
        </div>
        <p className="mt-1.5 text-[9px] text-stone-500">Сейчас включено: {enabledCount} из {EFFECTS.length}. Переключатели действуют и в редакторе, и в превью; состояние сохраняется вместе со сценой.</p>
      </Section>

      <Section title="Подсказки">
        <ul className="list-disc space-y-1 pl-4 text-[10px] leading-snug text-stone-400">
          <li>Правь мелкие детали — выключи <b className="text-stone-200">пыль</b>, <b className="text-stone-200">туман</b> и <b className="text-stone-200">тени</b>.</li>
          <li>Оценивай материал — выключи <b className="text-stone-200">солнце</b>, включи <b className="text-stone-200">небо</b> для мягкого ambient.</li>
          <li>Работай на слабом ПК — <b className="text-stone-200">тени</b> и <b className="text-stone-200">пост-обработка</b> самые дорогие.</li>
          <li>Сетка и границы коллизий переключаются на тулбаре и в панелях «Окружение» / «Свойства».</li>
        </ul>
      </Section>
    </div>
  );
}