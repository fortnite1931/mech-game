import type { WorldConfig } from '../three/worldGen.ts';
import { Section, Slider, Btn, Toggle } from './ui.tsx';
import { Dice5 } from 'lucide-react';

export function WorldPanel({ world, onWorld }: {
  world: WorldConfig; onWorld: (patch: Partial<WorldConfig>) => void;
}) {
  const onChange = onWorld;
  return (
    <div className="overflow-y-auto">
      <Section title="Мир (бесконечный)">
        <Toggle label="Бесконечный мир в превью" value={!!world.enabled}
          onChange={() => onChange({ enabled: !world.enabled })} />
        <Toggle label="Случайная точка старта" value={!!world.randomSpawn}
          onChange={() => onChange({ randomSpawn: !world.randomSpawn })} />
        <div className="mt-1.5 rounded-md border border-white/[0.07] bg-black/25 p-2 text-[10px] leading-relaxed text-stone-500">
          {world.enabled !== false
            ? 'Стен нет: земля и чанки продолжаются в любую сторону. Радиус чанков ниже — только сколько участков держим вокруг игрока (подгрузка/выгрузка).'
            : 'Конечная площадка 240×240 м. За её пределами мех не выезжает — так удобнее собирать сцену вручную.'}
        </div>
      </Section>

      <Section title="Seed мира">
        <div className="grid grid-cols-2 gap-1.5">
          <div className="col-span-1">
            <div className="mb-0.5 text-[10px] text-stone-500">Число мира</div>
            <input type="number" key={world.seed} defaultValue={world.seed} min={0} max={99998}
              className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
              onBlur={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange({ seed: Math.max(0, Math.min(99998, Math.round(v))) }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
          </div>
          <div className="flex items-end">
            <Btn onClick={() => onChange({ seed: Math.floor(Math.random() * 99999) })} className="w-full">
              <Dice5 size={13} /> Сменить
            </Btn>
          </div>
        </div>
      </Section>

      <Section title="Настройки генерации">
        <Slider label="Размер чанка, м" value={world.chunkSize} min={12} max={64} step={4}
          onChange={(v) => onChange({ chunkSize: v })} format={(v) => v.toFixed(0)} />
        <Slider label="Плотность пропов ×" value={world.propDensity} min={0} max={3} step={0.1}
          onChange={(v) => onChange({ propDensity: v })} format={(v) => v.toFixed(1)} />
        <Slider label="Шанс оазиса" value={world.oasisChance} min={0} max={0.2} step={0.005}
          onChange={(v) => onChange({ oasisChance: v })} format={(v) => v.toFixed(3)} />
        <Slider label="Радиус чанков" value={world.worldRadius} min={0} max={10} step={1}
          onChange={(v) => onChange({ worldRadius: v })}
          format={(v) => (v === 0 ? 'авто' : v.toFixed(0))} />
        <div className="mt-1 text-[9px] leading-relaxed text-stone-600">
          0 = считать от видимости (дальность тумана) с запасом: мир существует дальше
          края зрения, поэтому на горизонте ничего не возникает из ниоткуда.
          Лёгкие батчи стоят почти ничего — 1 draw call на вид. Дорогие «живые»
          объекты рядом с игроком — их по-прежнему немного.
        </div>
      </Section>

      <div className="mt-2 text-[10px] leading-relaxed text-stone-600">
        Оазисы — редкие зелёные острова. Seed управляет всей генерацией мира:
        биомы, пропы и точка старта детерминированы. Случайный спавн работает,
        когда в сцене нет объекта с ролью «Спавн».
      </div>
    </div>
  );
}
