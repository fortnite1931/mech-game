import type { WorldConfig } from '../three/worldGen.ts';
import { Section, Slider, Btn, Toggle } from './ui.tsx';
import { Dice5, Save, FolderOpen } from 'lucide-react';
import { useRef } from 'react';

export function WorldPanel({ world, onWorld, onSaveLevel, onLoadLevel }: {
  world: WorldConfig; onWorld: (patch: Partial<WorldConfig>) => void;
  /** Сохранить текущий проект как файл уровня (JSON). */
  onSaveLevel?: () => void;
  /** Загрузить уровень из файла (JSON). */
  onLoadLevel?: (file: File) => void;
}) {
  const onChange = onWorld;
  const levelFileRef = useRef<HTMLInputElement | null>(null);
  return (
    <div className="overflow-y-auto">
      <Section title="Мир (бесконечный)">
        <Toggle label="Бесконечный мир в превью" value={!!world.enabled}
          onChange={() => onChange({ enabled: !world.enabled })} />
        <Toggle label="Случайная точка старта" value={!!world.randomSpawn}
          onChange={() => onChange({ randomSpawn: !world.randomSpawn })} />
        <div className="mt-1.5 rounded-md border border-white/[0.07] bg-black/25 p-2 text-[10px] leading-relaxed text-stone-500">
          {world.enabled !== false
            ? 'При радиусе 0 земля и чанки продолжаются в любую сторону. Задай радиус карты ниже и выбери тип края — мир замкнётся горами, водой или лесом.'
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
        <Slider label="Радиус карты, км" value={world.worldRadius} min={0} max={8} step={1}
          onChange={(v) => onChange({ worldRadius: v })}
          format={(v) => (v === 0 ? 'бесконечно' : v.toFixed(0))} />
        <div className="mb-2 mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500">
          Край карты
        </div>
        <select
          value={world.edgeType}
          onChange={(e) => onChange({ edgeType: e.target.value as WorldConfig['edgeType'] })}
          disabled={world.worldRadius === 0}
          className="w-full rounded-md border border-white/10 bg-black/40 px-2 py-1.5 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none disabled:opacity-40"
        >
          <option value="none">Нет (плоскость)</option>
          <option value="mountains">Горы (плавный подъём)</option>
          <option value="cliffs">Скалы (крутой обрыв)</option>
          <option value="water">Вода (провал к морю)</option>
          <option value="forest">Лес (непроходимая чаща)</option>
        </select>
        <div className="mt-1 text-[9px] leading-relaxed text-stone-600">
          Край закрывает границу карты, когда задан радиус больше 0. Чем ближе к
          границе — тем выше горы (или глубже вода), и выйти за неё нельзя:
          физика не выпустит, чанки за краем не генерируются.
        </div>
      </Section>

      <Section title="Зоны (цели)">
        <div className="mb-1.5 text-[9px] leading-relaxed text-stone-600">
          Зона — точка интереса на карте. Когда игрок входит в неё, там спавнятся
          враги; зачисти всех — зона «очищена». Очисти все зоны — победа.
        </div>
        {(world.zones ?? []).map((z, i) => (
          <div key={z.id} className="mb-2 rounded-md border border-white/[0.07] bg-black/25 p-2">
            <div className="mb-1 flex items-center gap-1.5">
              <input
                value={z.name}
                onChange={(e) => {
                  const list = (world.zones ?? []).slice();
                  list[i] = { ...list[i], name: e.target.value };
                  onChange({ zones: list });
                }}
                className="flex-1 rounded border border-white/10 bg-black/40 px-1.5 py-1 text-[11px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
              />
              <button
                onClick={() => onChange({ zones: (world.zones ?? []).filter((_, j) => j !== i) })}
                className="rounded border border-white/10 px-1.5 py-1 text-[10px] text-stone-500 hover:border-red-500/40 hover:text-red-300"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {(["x", "z", "r"] as const).map((k) => (
                <div key={k}>
                  <div className="mb-0.5 text-[9px] uppercase text-stone-600">{k}</div>
                  <input
                    type="number" step={10}
                    value={z[k]}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const list = (world.zones ?? []).slice();
                      list[i] = { ...list[i], [k]: v };
                      onChange({ zones: list });
                    }}
                    className="w-full rounded border border-white/10 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-stone-200 focus:border-amber-500/50 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
        <Btn
          onClick={() => {
            const zones = world.zones ?? [];
            onChange({ zones: [...zones, { id: 'zone_' + Date.now(), name: `Зона ${zones.length + 1}`, x: 0, z: 0, r: 80 }] });
          }}
          className="w-full"
        >
          + Добавить зону
        </Btn>
      </Section>

      <Section title="Уровень (экспорт/импорт)">
        <div className="mb-1.5 text-[9px] leading-relaxed text-stone-600">
          Текущую сцену можно сохранить как файл уровня (JSON) и потом загрузить
          обратно — так удобно переносить уровень между сессиями/компьютерами
          и встраивать в готовую игру.
        </div>
        <div className="flex gap-1.5">
          <Btn onClick={() => onSaveLevel?.()} className="flex-1">
            <Save size={13} /> Сохранить уровень
          </Btn>
          <Btn onClick={() => levelFileRef.current?.click()} className="flex-1">
            <FolderOpen size={13} /> Загрузить уровень
          </Btn>
          <input
            ref={levelFileRef}
            type="file" accept=".json,application/json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f && onLoadLevel) onLoadLevel(f); e.target.value = ""; }}
          />
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
